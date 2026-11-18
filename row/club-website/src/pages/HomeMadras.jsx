// Port of HomeMadras.aspx + HomeMadras.aspx.cs — the madras-legacy Home layout:
// the old template-4 Home4.aspx markup fed from the new API. Behaviors mirror the
// ORIGINAL Home4 code-behind (decompiled from the deployed build): hi-IN
// "#,#.##" number formatting, the
// " Day :.. - Time :.." meeting line, no dignitary descriptions on the home,
// profile_pic.png photo fallback and the white/navy ad-card background switch.
//
// OnPreInit in the .cs bounces a direct hit under a different theme back to
// Home.aspx ("Home4.aspx shows the wrong theme" trap). App.jsx does that switch
// here — /Home.aspx picks the theme's home, /HomeMadras.aspx is pinned to the
// madras shell — so there is nothing to port for it.
//
// The owl carousels (#owl-demo, #owl-advt) are initialised by SiteMadras.jsx;
// this page only renders the same DOM.
//
// NOT PORTED: the page's HeadContent <style> block (.currently-loading and
// #countdown). Both selectors are legacy leftovers — nothing in this page's
// MainContent, or in SiteMadras.Master, ever renders those elements.
import { useEffect, useState } from 'react'
import { useClub } from '../context/ClubProvider.jsx'
import { moneySymbol, groupInt, isInr as isInrCurrency } from '../shared/money.js'
import * as api from '../api/clubService.js'
import { media, withYear, usePageTitle } from '../shared/rotaryPage.js'
import { useHomeData } from '../shared/homeData.js'   // adAnchorProps is JSX-only; the banner/ad slides are built as HTML (see fillOwl)
import { useRotaryAnim } from '../shared/useRotaryAnim.js'
import { loadThemeScripts } from '../theme/themeAssets.js'
import { initOwl } from '../layouts/SiteMadras.jsx'

// Image fallback chain: when a banner/ad image fails to load, try each
// pipe-separated URL in its data-fallbacks in turn (the legacy
// /uploads/<type>/<file> location, then the theme/placeholder), then stop.
//
// The original declares this as an inline <script> above the sliders; a <script>
// tag in JSX never executes, so it lives here and is wired through onError.
// The "no fallbacks left" branch just stops changing src (the original's
// img.onerror = null can't detach React's synthetic handler).
function rotaryImgFallback(img) {
  var rest = (img.getAttribute('data-fallbacks') || '').split('|').filter(Boolean)
  if (rest.length) {
    img.setAttribute('data-fallbacks', rest.slice(1).join('|'))
    img.src = rest[0]
  }
}

/** Legacy missing-photo art (Home4 used img/profile_pic.png, NOT noimg.png —
 *  that one only appears in the no-data cards). */
const PROFILE_FALLBACK = 'img/profile_pic.png'

/** HomeMadras.Img() — resolved media URL, or the legacy profile placeholder. */
function img(path) {
  const url = media(path)
  return url || PROFILE_FALLBACK
}

/**
 * The legacy number format, verbatim from the old Home4 BindData: "#,#.##" in
 * the hi-IN culture (Indian digit grouping, decimals only when present, 0
 * renders blank). Intl's en-IN uses the same {3,2} group sizes as .NET's hi-IN
 * and, like .NET, emits ASCII digits.
 */
function legacyNum(v, locale = 'en-IN') {
  if (!v) return ''
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v)
}

/** HomeMadras.StatValue — pull one tile's value out of a stat list by label. */
function statValue(stats, label) {
  for (const s of stats) {
    if (String(s.label).toLowerCase() === label.toLowerCase()) return s.value
  }
  return 0
}

// The bundled ad placeholder (HomePageBase.GetAdSlides' adPlaceholder). The .cs
// re-queries GetAdvertisements to ask "are there real ads?"; the ported hook
// already collapses the no-ads case to exactly this one placeholder slide, so
// the same question is answered off the built list.
const AD_PLACEHOLDER = 'img/ClubAdvirtisment.png'

export default function HomeMadras() {
  const club = useClub()
  // Madras binds banners/ads/stats/meeting from the shared HomePageBase layer.
  const d = useHomeData()
  const { banners, ads } = d

  usePageTitle(club.clubDisplayName)

  // ── Impact counters (count-box tiles), formatted like legacy BindData ──────
  // Same numbers as the other themes' stat bands (main-project count, totals
  // incl. children — all via HomePageBase), formatted with the legacy hi-IN
  // "#,#.##" pattern and its exact zero-guards.
  const projects = statValue(d.projectStats, 'Projects')
  const cost = statValue(d.projectStats, 'Total Cost')
  const beneficiaries = statValue(d.projectStats, 'Beneficiaries')
  const members = statValue(d.membershipStats, 'Members')
  const impact = d.impact || {}

  const projectsText = String(projects)
  const membersText = String(members)
  // Legacy guards verbatim: cost/TRF show "0" when empty; beneficiaries/
  // man-hours use the raw format (which renders 0 as blank, as legacy did).
  // The legacy template states the currency in the ICON, not the text — which
  // only works while that icon is a ₹. Off INR the icon is a neutral coin, so
  // the symbol has to move into the string or the figure names no currency.
  const isInr = isInrCurrency(club.currency)
  const costText = cost > 0
    ? (isInr ? legacyNum(cost) : moneySymbol(club.currency) + groupInt(cost, club.currency))
    : '0'
  const beneficiariesText = legacyNum(beneficiaries, isInr ? 'en-IN' : 'en-US')
  // TRF (USD) tile — /v2/impact's totalTrfUsd.
  const trfText = impact.totalTrfUsd > 0 ? legacyNum(impact.totalTrfUsd, 'en-US') : '0'

  // Legacy avd card: white behind real ad images, navy (#0c3c7c) behind the
  // bundled placeholder.
  const realAds = !(ads.length === 1 && ads[0].img === AD_PLACEHOLDER)
  const adCardStyle = { backgroundColor: realAds ? '#ffffff' : '#0c3c7c' }

  // ── Meeting band: venue line + " Day :.. - Time :.." line, whole band hidden
  //    when the club has no meeting record. ──────────────────────────────────
  const about = d.about
  const day = about ? String(about.meetingDay || '').trim() : ''
  const time = about ? String(about.meetingFromTime || '').trim() : ''
  const meetingVenueText = !about ? '' : [about.meetingAddress, about.city, about.state, about.pincode]
    .filter((s) => s && String(s).trim()).join(', ')
  const hasMeetingInfo = day.length > 0 || time.length > 0 || meetingVenueText.length > 0
  const meetingLine = ' Day :' + day + ' - Time :' + time

  // ── Dignitaries (RI President / DG / Club President / Secretary). ──────────
  //    The legacy home showed photo + name + designation ONLY (its Desc labels
  //    were never populated), so no description fields here.
  //    LoadDignitaries() is ported straight rather than read off the shared
  //    hook's `leaders` list: that list substitutes a "Not available" entry for
  //    a missing IP/DG, whereas this layout needs the has/hasn't flag to pick
  //    the noimg.png no-data card instead. Every call below is already cached
  //    by the shared hook's fetch, so this costs no extra round trip.
  const [dig, setDig] = useState({ hasIp: false, hasDg: false, hasPres: false, hasSecy: false })

  useEffect(() => {
    if (!club.clubId) return
    let cancelled = false

    ;(async () => {
      const [ip, dg, bod] = await Promise.all([
        api.getInternationalPresident(club.clubId, club.selectedYearId),
        api.getDistrictGovernor(club.clubId, club.selectedYearId),
        api.getBod(club.clubId, club.selectedYearId),
      ])
      if (cancelled) return

      const next = { hasIp: false, hasDg: false, hasPres: false, hasSecy: false }

      if (ip && ip.name) {
        next.hasIp = true
        next.ipName = ip.name
        next.ipDesignation = ip.designation || 'RI President'
        next.ipImg = img(ip.profilePhotoPath)
      }

      if (dg && dg.memberName) {
        next.hasDg = true
        next.dgName = dg.memberName
        next.dgDesignation = 'District Governor'
        next.dgImg = img(dg.profilePhoto)
      }

      // Same picks as the classic home's leader rail (HomePageBase.GetLeaders).
      let pres = null, secy = null
      for (const b of bod) {
        const desig = b.designation || ''
        if (!pres && desig.toLowerCase().includes('president')) pres = b
        if (!secy && desig.toLowerCase().includes('secretary')) secy = b
      }
      if (pres) {
        next.hasPres = true
        next.presName = pres.memberName
        next.presDesignation = pres.designation
        next.presImg = img(pres.profilePhotoPath)
      }
      if (secy) {
        next.hasSecy = true
        next.secyName = secy.memberName
        next.secyDesignation = secy.designation
        next.secyImg = img(secy.profilePhotoPath)
      }

      setDig(next)
    })()

    return () => { cancelled = true }
  }, [club.clubId, club.selectedYearId])

  // ── The two owl carousels: React renders the containers EMPTY ─────────────
  // Owl v2 moves whatever it finds into .owl-stage-outer > .owl-stage > .owl-item
  // wrappers it creates. When the slides were JSX children, those nodes belonged
  // to React AND had been re-parented by owl — so the next re-render (changing
  // the Rotary year, which swaps banners/ads) hit
  //     NotFoundError: Failed to execute 'removeChild' on 'Node'
  // and React tore the whole app down: blank page, no header. Nothing about the
  // hamburger/year fix caused it — it reproduced with the drawer shut — it just
  // needed an in-place re-render of this page, which only a year change does.
  //
  // Fix is ownership, not timing: React never puts a child in these containers,
  // so it can never try to remove one. We write the slides ourselves, destroying
  // owl first so it re-wraps cleanly (SiteMadras's MutationObserver notices the
  // new children and re-inits — it is guarded on .owl-loaded, which destroy
  // clears). Handlers are inline attributes because these nodes are outside
  // React's tree and never get synthetic events.
  useEffect(() => {
    const enc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    function fillOwl(id, html) {
      const el = document.getElementById(id)
      if (!el) return
      const $ = window.jQuery
      if ($ && $.fn && $.fn.owlCarousel && el.classList.contains('owl-loaded')) {
        try { $(el).trigger('destroy.owl.carousel') } catch (e) { /* re-init below regardless */ }
      }
      el.classList.remove('owl-loaded', 'owl-drag', 'owl-hidden')
      el.innerHTML = html
    }

    // A banner with a typed link / uploaded document becomes the slide's own
    // anchor (never a wrapper inside it — owl owns the direct child). `a` is
    // inline, so it needs display:block for .slide-item's height/object-fit fill.
    fillOwl('owl-demo', banners.map((b) => {
      const photo = '<img class="slide-photo" src="' + enc(b.src) +
        '" data-fallbacks="' + enc(b.fallbacks) +
        '" onerror="window.__madrasImgFallback&&window.__madrasImgFallback(this)" alt="Banner" />'
      return b.url
        ? '<a class="slide-item" style="display:block" href="' + enc(b.url) +
          '" target="_blank" rel="noopener noreferrer" aria-label="' +
          enc(b.title || 'Open banner link') + '">' + photo + '</a>'
        : '<div class="slide-item">' + photo + '</div>'
    }).join(''))

    fillOwl('owl-advt', ads.map((ad) => {
      const inert = !ad.url || ad.url === '#'
      return '<a class="aspNetDisabled" href="' + enc(ad.url || '#') + '"' +
        (inert ? ' aria-disabled="true" tabindex="-1" style="cursor:default" onclick="return false"'
               : ' target="_blank" rel="noopener noreferrer"') +
        '><img class="adimg" src="' + enc(ad.img) + '" data-fallbacks="' + enc(ad.fallbacks) +
        '" onerror="window.__madrasImgFallback&&window.__madrasImgFallback(this)" alt="Advertisement" width="100%" /></a>'
    }).join(''))

    // Re-init here rather than leaning on SiteMadras's MutationObserver: that one
    // defers through requestAnimationFrame, so the carousels come back a frame
    // late at best and not at all where rAF is throttled. loadThemeScripts is
    // memoised per URL, so this is just "wait for the owl script already loading".
    loadThemeScripts('madras-legacy').then(initOwl)
  }, [banners, ads])

  // The slides live outside React, so their onerror has to reach a global.
  useEffect(() => { window.__madrasImgFallback = rotaryImgFallback }, [])

  useRotaryAnim([d.loading, banners.length, ads.length, hasMeetingInfo, dig])

  return (
    <>
      <section className="banner-section">
        <div className="container">
          <div className="row mt-3">
            <div className="col-md-6 mb-3 mb-md-0" style={{ zIndex: '000' }}>
              <div className="main-slider slider-active">
                {/* Children are written imperatively — see fillOwl(). React must
                    not own anything inside an owl container. */}
                <div id="owl-demo" className="owl-carousel owl-theme" />
              </div>
            </div>
            <div className="col-md-3 align-items-stretch  mb-3 mb-md-0">
              <div className="card h-100" id="avd" style={adCardStyle}>
                <div className="advt-slider">
                  <div id="owl-advt" className="owl-carousel owl-theme" />
                </div>
              </div>
            </div>
            <div className="col-md-3 align-items-stretch">
              <div className="club-box lg-buttons-holder">

                <div className="card">
                  <a href="/calendar" className="">
                    <div className="color-1 lg-btn-icon">
                      <i className="fal fa-birthday-cake"></i>
                    </div>
                    <div className="ms-3 lg-btn-title">

                      <span className="color-1">CALENDAR</span>
                    </div>
                    <div className="ms-auto">
                      <i className="fal fa-chevron-right"></i>
                    </div>
                  </a>
                </div>
                <div className="card">
                  <a href="/events" className=" ">
                    <div className="color-6 lg-btn-icon">
                      <i className="fal fa-handshake"></i>
                    </div>
                    <div className="ms-3 lg-btn-title">
                      UPCOMING <span className="color-6">CLUB EVENTS</span>
                    </div>
                    <div className="ms-auto">
                      <i className="fal fa-chevron-right"></i>
                    </div>
                  </a>
                </div>
                <div className="card m-0">
                  <a href="/newsletters" className="">
                    <div className="color-5 lg-btn-icon">
                      <i className="fal fa-envelope"></i>
                    </div>
                    <div className="ms-3 lg-btn-title">
                      CLUB<span className="color-5">NEWSLETTERS</span>
                    </div>
                    <div className="ms-auto">
                      <i className="fal fa-chevron-right"></i>
                    </div>
                  </a>
                </div>

              </div>
            </div>

          </div>
        </div>
      </section>

      {/* "Click here to view our Projects" button removed from the home (client, 2026-11-17); Projects stays in the menu */}
      {/* Legacy pnl_counts Panel. The Web Forms original kept it hidden until the
          pulse link above was clicked — but that link reads "view our Projects",
          so a visitor pressed it expecting the projects list and the band was
          the surprise. The link goes to /projects now, which leaves nothing to
          reveal the band, so it simply shows: these are the club's headline
          figures and every other theme prints them without asking. */}
      <div id="pnl_counts">
      <section id="div_counts_avenue" className="d-flex flex-column flex-md-row my-4 mb-0 justify-content-md-around count_box_holder">

        <div className="count-box">
          <div className="count-icon">
            <i className="fal fa-calendar-star"></i>
          </div>
          <div className="count-number">
            <span>{projectsText}</span>
          </div>
          <div className="count-text">Projects</div>
        </div>
        <div className="count-box">
          <div className="count-icon">
            <i className="fal fa-users"></i>
          </div>
          <div className="count-number">
            <span>{membersText}</span>
          </div>
          <div className="count-text">Members</div>
        </div>
        <div className="count-box">
          <div className="count-icon">
            {/* madras-legacy is pinned to RC Madras (India), so this is ₹ in
                practice - but a ?theme= preview can put any club in this shell,
                and a rupee glyph over "Rs 8,160,001" would be a lie. */}
            <i className={isInrCurrency(club.currency)
                 ? "fal fa-rupee-sign" : "fal fa-coins"}></i>
          </div>
          <h3 className="count-number">
            <span>{costText}</span>
          </h3>
          <div className="count-text">Cost</div>
        </div>
        <div className="count-box" style={{ display: 'none' }}>
          <div className="count-icon">
            <i className="fal fa-user-tie"></i>
          </div>
          <div className="count-number">
            <span>0</span>
          </div>
          <div className="count-text">ROTARIANS INVOLVED</div>
        </div>


        <div className="count-box">
          <div className="count-icon">
            <i className="fal fa-hands-heart"></i>
          </div>
          <div className="count-number">
            <span>{beneficiariesText}</span>
          </div>
          <div className="count-text">Beneficiaries</div>
        </div>
        <div className="count-box">
          <div className="count-icon">
            <i className="fal fa-dollar-sign"></i>
          </div>
          <div className="count-number">
            <span>{trfText}</span>
          </div>
          <div className="count-text">TRF (USD)</div>
        </div>

        <div className="events-section clearfix" style={{ display: 'none' }}>
          <div className="container">

            <div className="event-pipes">
            </div>
          </div>
        </div>
      </section>
      </div>
      {hasMeetingInfo && (
      <div className="club-meeting py-4 bg-white mb-3" id="divDateTime">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-md-5">
              <div className="d-flex handshake_div">
                <i className="fa fa-handshake"></i>
                <h2>WHERE AND WHEN
                  <br/>
                  <span>DO WE MEET</span></h2>
              </div>
            </div>
            <div className="col-md-7">
              <span>{meetingVenueText}</span><br />
              <span>{meetingLine}</span>
            </div>
          </div>
        </div>
      </div>
      )}
      <div className="container">
        <div className="row mb-3">
          <div className="col-12 col-md-6">
            <div className="bg-white dignitaries p-3">
              <div className="text-center mb-4 mb-md-0">
                <h3 className="title_section my-2 mb-3 text-center">DIGNITARIES OF ROTARY
									<span></span>
                </h3>
              </div>
              <div className="row">
                <div className="col-12 col-md-6 position-relative">
                  {dig.hasIp ? (
                  <div id="div_yesInterPresident" className="digni-box">

                    <img id="img_international_president" className="img-fluid" src={dig.ipImg} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'img/profile_pic.png' }} />

                    <h4 className="card-title">
                      <a href={withYear('/dignitary?Type=1', club.selectedYearId)} target="_blank">
                        <span>{dig.ipName}</span>
                      </a>
                    </h4>
                    <p className="card-text">
                      <span>{dig.ipDesignation}</span>
                    </p>
                    <span></span>
                    <a href={withYear('/dignitary?Type=1', club.selectedYearId)} className="btn btn-primary btn-sm " target="_blank">Know More</a>
                  </div>
                  ) : (
                  /* No-data placeholder uses the SAME .digni-box structure as a
                     real card (and as the President/Secretary no-data cards) so
                     its height matches — the legacy .card>.leader-img structure
                     rendered a taller, unbalanced empty box. */
                  <div className="digni-box" id="div_noInterPresident">
                    <img id="img_noInterPresident" src="Themes/madras-legacy/img/noimg.png" alt="rotary" className="img-fluid" />
                    <h4 className="card-title">
                      <a>&nbsp;</a>
                    </h4>
                    <p className="card-text">
                      &nbsp;
                    </p>
                    <span>&nbsp;</span>
                  </div>
                  )}
                  <span className="lines-divider d-none d-md-block"></span>
                </div>
                <div className="col-12 col-md-6">
                  {dig.hasDg ? (
                  <div className="digni-box" id="div_yesDG">
                    <img id="img_international_DG" className="img-fluid" src={dig.dgImg} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'img/profile_pic.png' }} />
                    <h4 className="card-title">
                      <a href={withYear('/dignitary?Type=2', club.selectedYearId)} target="_blank">
                        <span className="dg1">{dig.dgName}</span>
                      </a>
                    </h4>
                    <p className="card-text">
                      <span>{dig.dgDesignation}</span>
                    </p>
                    <span>
                      <span></span>
                    </span>
                    <a className="btn btn-primary btn-sm " href={withYear('/dignitary?Type=2', club.selectedYearId)} target="_blank">Know More</a>
                  </div>
                  ) : (
                  <div className="digni-box" id="div_NoDG">
                    <img id="img1" src="Themes/madras-legacy/img/noimg.png" alt="rotary" className="img-fluid" />
                    <h4 className="card-title">
                      <a>&nbsp;</a>
                    </h4>
                    <p className="card-text">
                      &nbsp;
                    </p>
                    <span>&nbsp;</span>
                  </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="col-12 col-md-6">
            <div className="bg-white dignitaries p-3">
              <div className="text-center mb-4 mb-md-0">
                <h3 className="title_section my-2 mb-3 text-center">CLUB LEADERS
									<span></span>
                </h3>
              </div>
              <div className="row">
                <div className="col-12 col-md-6 position-relative">
                  {dig.hasPres ? (
                  <div className="digni-box" id="div_yesClubPresident">
                    <img id="img_Clubpresident" className="img-fluid" src={dig.presImg} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'img/profile_pic.png' }} />
                    <h4 className="card-title">
                      <a href={withYear('/dignitary?Type=4', club.selectedYearId)} target="_blank">
                        <span className="dg1">{dig.presName}</span>
                      </a>
                    </h4>
                    <p className="card-text">
                      <span>{dig.presDesignation}</span>
                    </p>
                    <span>
                      <span></span>
                    </span>
                    <a className="btn btn-primary btn-sm " href={withYear('/dignitary?Type=4', club.selectedYearId)} target="_blank">Know More</a>
                  </div>
                  ) : (
                  <div className="digni-box" id="div_NoClubPresident">
                    <img id="img2" src="Themes/madras-legacy/img/noimg.png" alt="rotary" className="img-fluid" />
                    <h4 className="card-title">
                      <a>&nbsp;</a>
                    </h4>
                    <p className="card-text">
                      &nbsp;
                    </p>
                    <span>&nbsp;
                    </span>
                  </div>
                  )}
                </div>
                <div className="col-12 col-md-6">
                  {dig.hasSecy ? (
                  <div className="digni-box" id="div_yesSecretary">
                    <img id="img_ClubSecretary" alt="rotary" className="img-fluid" src={dig.secyImg} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'img/profile_pic.png' }} />
                    <h4 className="card-title">
                      <a href={withYear('/dignitary?Type=5', club.selectedYearId)} target="_blank">
                        <span className="dg1">{dig.secyName}</span>
                      </a>
                    </h4>
                    <p className="card-text">
                      <span>{dig.secyDesignation}</span>
                    </p>
                    <span>
                      <span></span>
                    </span>
                    <a className="btn btn-primary btn-sm" href={withYear('/dignitary?Type=5', club.selectedYearId)} target="_blank">Know More</a>
                  </div>
                  ) : (
                  <div className="digni-box" id="div_noSecretary">
                    <img id="img3" src="Themes/madras-legacy/img/noimg.png" alt="rotary" className="img-fluid" />
                    <h4 className="card-title">
                      <a>&nbsp;</a>
                    </h4>
                    <p className="card-text">
                      &nbsp;
                    </p>
                    <span>&nbsp;
                    </span>
                  </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
