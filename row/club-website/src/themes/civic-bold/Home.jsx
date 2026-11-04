'use client'
// Port of HomeCivicBold.aspx + HomeCivicBold.aspx.cs — the CIVIC-BOLD (theme 4)
// home body only ("Azure Editorial Cinema" composition).
//
// The C# class inherits all its data from HomePageBase (ported once in
// ../shared/homeData.js); only the markup differs. In Web Forms it is reached by
// Server.Transfer from Home.aspx when the resolved theme is civic-bold — App.jsx
// does that switch here, so this file is purely the civic layout and needs no
// deep-link guard (OnPreInit's redirect back to Home.aspx has no equivalent).
//
// NOT ported — dead code in the original: the counter band's OWN year control
// (CounterIsAllYears / CounterYearId / GetCounterStats / RenderCounterYearOptions
// / ResolveCounterYear / FmtYear). Page_Load never calls ResolveCounterYear and
// the markup never renders the picker: "the counter's own 'All Years' picker was
// removed by request", so rptStats binds the plain GetProjectStats() for the
// CURRENT (header) year.
import { useEffect } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import { media, withYear, usePageTitle, wheelFallback } from '@/themes/shared/rotaryPage.js'
import { enc } from '@/themes/shared/Breadcrumb.jsx'
import { useHomeData, adAnchorProps } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'
import { loadStylesheet } from '@/site/themeAssets.js'

// Home-only premium composition layer ("Azure Editorial Cinema" redesign).
// Loads after theme.css + civic-motion.css so it wins the cascade.
// v=45: illustrated "No Upcoming Events" card (.cv2-empty-events) in the hero events pane
//
// The original declares this in the page's HeadContent placeholder; the SPA has
// no per-page <head>, so the sheet is appended (once, idempotently) on mount —
// after the theme's sheets, which the shell has already injected.
const CIVIC_HOME_CSS = '/Themes/civic-bold/css/civic-home.css?v=48'

// Banner/ad onerror fallback chain (mirrors the other themes): step through
// the pipe-separated data-fallbacks list, then give up.
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

// ── Marquee content ─────────────────────────────────────────────────────────
// Rotary's two evergreen mottos plus the RI annual presidential themes /
// messages, newest year first. The club name is woven in as the gold accent.
// (RI replaced the yearly "theme" with a strategic "presidential message" from
// 2025-26, but each still reads as that year's rallying line.)
const MARQUEE_THEMES = [
  'Service Above Self',              // Rotary motto
  'Create Lasting Impact',           // 2026-27
  'Unite for Good',                  // 2025-26
  'The Magic of Rotary',             // 2024-25
  'Create Hope in the World',        // 2023-24
  'Imagine Rotary',                  // 2022-23
  'Serve to Change Lives',           // 2021-22
  'Rotary Opens Opportunities',      // 2020-21
  'People of Action',                // Rotary motto
  'Rotary Connects the World',       // 2019-20
  'Be the Inspiration',              // 2018-19
  'Rotary: Making a Difference',     // 2017-18
  'Rotary Serving Humanity',         // 2016-17
  'Be a Gift to the World',          // 2015-16
  'Light Up Rotary',                 // 2014-15
  'Engage Rotary, Change Lives',     // 2013-14
]

/**
 * One marquee group's items — every Rotary theme (see MARQUEE_THEMES) as a word
 * + diamond dot, with the club name woven in as the gold accent after every
 * fourth theme. `startOffset` rotates the list so the two counter-scrolling rows
 * show different phrases at the same horizontal position. Rendered twice per row
 * (identical) so the -50% scroll loops seamlessly.
 *
 * A StringBuilder in the C#, so it stays a string builder here and is injected
 * with dangerouslySetInnerHTML.
 */
function renderMarqueeItems(startOffset, clubDisplayName) {
  let sb = ''
  const club = enc(clubDisplayName)
  const n = MARQUEE_THEMES.length
  for (let k = 0; k < n; k++) {
    const t = MARQUEE_THEMES[((startOffset % n) + k) % n]
    sb += '<span class="cv-marquee__item">' + enc(t) + '</span><span class="cv-marquee__dot">&#9670;</span>'
    if ((k + 1) % 4 === 0) {
      sb += '<span class="cv-marquee__item cv-marquee__item--accent">' + club +
        '</span><span class="cv-marquee__dot">&#9670;</span>'
    }
  }
  return sb
}

export default function HomeCivicBold({ data }) {
  const club = useClub()
  // The arc ring holds at most 30 projects - its design count (ARC.N in
  // Themes/civic-bold/js/rotary-anim.js). Its radius grows with the card count
  // against a fixed 2800px perspective: 60+ cards zoom the front card 3x+, and
  // 88+ put it behind the camera, so the band went BLANK for big clubs
  // (rcsurendranagar: 236 projects, 2026-10-01). Fewer than 30 are cloned up to
  // 30, so smaller clubs are unchanged; "All projects" carries the rest.
  // GetNewsletterItems(4) is the default take.
  const d = useHomeData(data.home, { featuredTake: 30, newsletterTake: 4 })
  const {
    banners, ads, projectStats, membershipStats, featured, newsletters, events,
    meetingDay, meetingTime, meetingVenue, mapUrl,
    featuredCount, eventsCount, newslettersCount,
  } = d

  usePageTitle(club.clubName)

  useEffect(() => { loadStylesheet(CIVIC_HOME_CSS, 'civic-bold') }, [])

  useRotaryAnim([d.loading, banners.length, ads.length, featuredCount, eventsCount, newslettersCount, d.leaders.length])

  const marqueeA = renderMarqueeItems(0, club.clubDisplayName)
  const marqueeB = renderMarqueeItems(8, club.clubDisplayName)

  return (
    <>
      {/* ══ 1 · HERO 3-UP — Advertisements | Banner | Upcoming events ══
          Multi-tenant hero: every pane is club data from the API (no hard-coded
          copy — the site serves many clubs). Aurora glows + blueprint grid +
          film grain behind; the centre glass poster-frame shows the full 16:5
          banner (aspect-lock decision holds: object-contain over blur fill). */}
      <section className="cv2-hero">
        {/* Meridian night sky: canvas starfield + gold wheel (initStarfield),
            azure/gold veil, film grain. Always dark in both site modes. */}
        <div className="cv2-hero__bg" data-stars aria-hidden="true"></div>
        <div className="cv2-hero__veil" aria-hidden="true"></div>
        <div className="cv2-noise" aria-hidden="true"></div>

        <div className="container-x">
          <div className="cv2-hero3">
            {/* LEFT · advertisement slider (well-wishers) */}
            <aside className="cv2-hero3__ads" data-onload="up" style={{ '--od': '.24s' }}>
              <div className="cv2-adframe cv2-adframe--fill tilted-card" data-tilt-max="4">
                <div className="cv2-adframe__stage" data-hero data-hero-interval="4500">
                  {ads.map((ad, i) => (
                    <a key={i} href={ad.url} {...adAnchorProps(ad.url)} data-hero-slide className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-700">
                      {/* Ads have no enforced upload ratio (the dashboard locks
                          banners to 16:5, posters to nothing), so object-cover on
                          this square plate sliced the creative. Show the WHOLE ad
                          with object-contain and fill the leftover with a blurred
                          cover copy — the same treatment warm-modern uses. The
                          sharp copy must be absolute too: a positioned blur sibling
                          paints over static in-flow content and would bury the ad
                          under its own blur. */}
                      <img src={ad.img} data-fallbacks={ad.fallbacks} alt="" aria-hidden="true" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg" />
                      <img src={ad.img} data-fallbacks={ad.fallbacks} alt="Advertisement" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full object-contain" />
                    </a>
                  ))}
                  <div className="cv2-frame__dots">
                    {ads.map((_, i) => (
                      <button key={i} type="button" data-hero-dot aria-label="Go to advertisement" className="w-2 bg-white/60"></button>
                    ))}
                  </div>
                </div>
              </div>
            </aside>

            {/* CENTRE · banner poster-frame (3D mouse tilt + Ken Burns kept) */}
            <div className="cv2-hero3__main" data-onload="zoom" style={{ '--od': '.12s' }}>
              <div className="cv2-frame tilted-card" data-tilt-max="3">
                <div className="cv2-frame__stage cv2-frame__stage--fill" data-hero data-hero-banner data-hero-interval="5000">
                  {banners.map((b, i) => {
                    // Banner fills the box edge-to-edge, no gaps, no blur.
                    const img = <img src={b.src} data-fallbacks={b.fallbacks} alt="Banner" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full object-cover" />
                    const slideClass = 'absolute inset-0 opacity-0 transition-opacity duration-700'
                    // The anchor must BE the slide: rotary-anim.js kills pointer events on
                    // [data-hero-slide] only, so a nested <a> would swallow the visible slide's clicks.
                    return b.url
                      ? <a key={i} href={b.url} {...adAnchorProps(b.url)} aria-label={b.title || 'Open banner link'} data-hero-slide className={slideClass}>{img}</a>
                      : <div key={i} data-hero-slide className={slideClass}>{img}</div>
                  })}
                  <div className="cv2-frame__dots">
                    {banners.map((_, i) => (
                      <button key={i} type="button" data-hero-dot aria-label="Go to slide" className="w-2 bg-white/60"></button>
                    ))}
                  </div>
                  <div className="cv2-frame__controls">
                    <button type="button" data-hero-prev aria-label="Previous slide" className="cv2-frame__btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <button type="button" data-hero-next aria-label="Next slide" className="cv2-frame__btn">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT · upcoming events (compact cards; pane shows max 3) */}
            <aside className="cv2-hero3__events" data-onload="up" style={{ '--od': '.36s' }}>
              <div className="cv2-panehead">
                <span className="cv2-panehead__label"><span aria-hidden="true">&#9670;</span> Upcoming events</span>
              </div>
              {eventsCount === 0 ? (
              <div className="cv2-empty-events">
                <svg className="cv2-empty-events__art" width="200" height="164" viewBox="0 0 200 164" fill="none" aria-hidden="true">
                  <ellipse cx="104" cy="96" rx="92" ry="58" fill="#D4A429" fillOpacity="0.12"/>
                  <ellipse cx="82" cy="80" rx="58" ry="46" fill="#D4A429" fillOpacity="0.08"/>
                  <g fill="#F0CE72" fillOpacity="0.75">
                    <path d="M176 46l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>
                    <path d="M20 92l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/>
                    <path d="M118 16l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                  </g>
                  <path d="M28 130h34l-5 24a4 4 0 0 1-4 3H37a4 4 0 0 1-4-3l-5-24Z" fill="#D4A429"/>
                  <rect x="24" y="124" width="42" height="9" rx="4" fill="#9C7413"/>
                  <path d="M45 124C18 112 14 78 22 58 46 70 47 104 45 124Z" fill="#D4A429" fillOpacity="0.85"/>
                  <path d="M45 124C64 106 70 76 56 54 46 74 44 102 45 124Z" fill="#9C7413" fillOpacity="0.7"/>
                  <path d="M45 124C38 100 40 78 45 62 52 82 50 106 45 124Z" fill="#F0CE72" fillOpacity="0.95"/>
                  <rect x="76" y="40" width="104" height="108" rx="14" fill="#FBFAF7" stroke="#061634" strokeWidth="3.5"/>
                  <path d="M76 54a14 14 0 0 1 14-14h76a14 14 0 0 1 14 14v16H76V54Z" fill="#D4A429"/>
                  <line x1="102" y1="24" x2="102" y2="46" stroke="#061634" strokeWidth="3.5" strokeLinecap="round"/>
                  <circle cx="102" cy="22" r="6" fill="#FBFAF7" stroke="#061634" strokeWidth="3.5"/>
                  <line x1="154" y1="24" x2="154" y2="46" stroke="#061634" strokeWidth="3.5" strokeLinecap="round"/>
                  <circle cx="154" cy="22" r="6" fill="#FBFAF7" stroke="#061634" strokeWidth="3.5"/>
                  <g fill="#D4A429" fillOpacity="0.3">
                    <rect x="90" y="80" width="16" height="16" rx="5"/>
                    <rect x="112" y="80" width="16" height="16" rx="5"/>
                    <rect x="134" y="80" width="16" height="16" rx="5"/>
                    <rect x="156" y="80" width="12" height="16" rx="5"/>
                    <rect x="90" y="104" width="16" height="16" rx="5" fillOpacity="0.55"/>
                    <rect x="112" y="104" width="16" height="16" rx="5"/>
                    <rect x="134" y="104" width="16" height="16" rx="5"/>
                    <rect x="90" y="128" width="16" height="10" rx="5"/>
                    <rect x="112" y="128" width="16" height="10" rx="5" fillOpacity="0.55"/>
                  </g>
                </svg>
                <h4 className="cv2-empty-events__title">No Upcoming Events</h4>
                <div className="cv2-empty-events__rule" aria-hidden="true"></div>
                <p className="cv2-empty-events__desc">We're working on something exciting &mdash; check back soon for our next gathering.</p>
              </div>
              ) : (
              <div className="cv2-evlist">
                {events.map((ev) => (
                  <a key={ev.id} href={withYear('/event?id=' + ev.id, club.selectedYearId)} className="cv2-ev">
                    <span className="cv2-ev__media">
                      <img src={ev.img} alt={ev.title} loading="lazy" onError={wheelFallback} />
                      <span className="cv2-ev__date" aria-hidden="true"><b>{ev.day}</b><span>{ev.mon}</span></span>
                    </span>
                    <span className="cv2-ev__body">
                      <span className="cv2-ev__title">{ev.title}</span>
                      <span className="cv2-ev__meta">{ev.date} &middot; {ev.venue}</span>
                      <span className="cv2-ev__more">Read more <span aria-hidden="true">&rarr;</span></span>
                    </span>
                  </a>
                ))}
              </div>
              )}
              <a href="/events" className="cv2-evall">View all events <span aria-hidden="true">&rarr;</span></a>
            </aside>
          </div>
        </div>

        {/* wavy paper exit — the night sky melts into the paper ticker below */}
        <svg className="cv2-wave" viewBox="0 0 1440 110" preserveAspectRatio="none" aria-hidden="true">
          <path fill="#FBFAF7" d="M0,64 C220,110 380,8 720,42 C1040,74 1220,116 1440,58 L1440,110 L0,110 Z"/>
        </svg>
      </section>

      {/* ══ MARQUEE TICKER — kinetic divider between the hero and the numbers ══ */}
      <section className="cv-marquee" aria-hidden="true">
        {/* Row A — solid, scrolls left. Two identical groups = seamless loop.
            Items are every Rotary motto + annual RI theme (see renderMarqueeItems). */}
        <div className="cv-marquee__row">
          <div className="cv-marquee__track cv-marquee__track--a">
            <div className="cv-marquee__group" dangerouslySetInnerHTML={{ __html: marqueeA }} />
            <div className="cv-marquee__group" aria-hidden="true" dangerouslySetInnerHTML={{ __html: marqueeA }} />
          </div>
        </div>
        {/* Row B — outlined ghost, scrolls right (reversed), different speed. Rotated
            start so the two rows show different themes at the same horizontal spot. */}
        <div className="cv-marquee__row">
          <div className="cv-marquee__track cv-marquee__track--b">
            <div className="cv-marquee__group cv-marquee__group--ghost" dangerouslySetInnerHTML={{ __html: marqueeB }} />
            <div className="cv-marquee__group cv-marquee__group--ghost" aria-hidden="true" dangerouslySetInnerHTML={{ __html: marqueeB }} />
          </div>
        </div>
      </section>

      {/* ══ 2 · IMPACT BY THE NUMBERS — glass bento stat band ══ */}
      <section id="numbers" className="cv2-sect">
        <div data-reveal-sect className="container-x">
          <div className="cv2-head">
            <div className="reveal">
              <h2 className="font-heading text-3xl font-extrabold uppercase leading-[0.95] tracking-tight text-ink md:text-5xl">Impact you can count.</h2>
            </div>
          </div>
          {/* Two labelled columns: PROJECTS (4 stats, 2x2) + MEMBERSHIP (Members only,
              the gradient feature tile). cv-stat-group/-grid supply the flex column. */}
          <div className="cv2-statcols">
            <div className="cv-stat-group reveal">
              <p className="cv2-group-label"><span aria-hidden="true">&#9670;</span> Projects</p>
              <div className="cv2-statgrid cv-stat-grid cv-stagger">
                {projectStats.map((s, i) => (
                  <div key={i} className="reveal cv2-stat">
                    <span className="cv2-stat__icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: s.icon }} />
                    <div>
                      <div className="civic-num" key={s.value + '|' + s.placeholder} data-count={s.value} data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                      <div className="cv2-stat__label">{s.label}</div>
                      <span className="cv2-stat__bar" aria-hidden="true"></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="cv-stat-group reveal">
              <p className="cv2-group-label"><span aria-hidden="true">&#9670;</span> Membership</p>
              <div className="cv2-statgrid cv-stat-grid">
                {membershipStats.map((s, i) => (
                  <div key={i} className="reveal cv2-stat cv2-stat--feature">
                    <span className="cv2-stat__icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: s.icon }} />
                    <div>
                      <div className="civic-num" key={s.value + '|' + s.placeholder} data-count={s.value} data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                      <div className="cv2-stat__label">{s.label}</div>
                      <span className="cv2-stat__bar" aria-hidden="true"></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ 3 · DIGNITARIES & LEADERS — editorial duotone portrait tiles ══ */}
      <section id="leadership" className="cv2-sect">
        <div data-reveal-sect className="container-x">
          <div className="cv2-head reveal">
            <div>
              <h2 className="font-heading text-3xl font-extrabold uppercase leading-[0.95] tracking-tight text-ink md:text-5xl">Dignitaries &amp; Leaders.</h2>
            </div>
          </div>
          <div className="cv-leader-row cv-stagger">
            {d.leaders.map((l) => (
              <a key={l.type} href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)} className="reveal cv-leader group">
                <img src={l.img} alt={l.name} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = 'img/profile_pic.png' }} className="cv-leader__img" />
                <span className="cv-leader__scrim" aria-hidden="true"></span>
                <span className="cv-leader__bar" aria-hidden="true"></span>
                <div className="cv-leader__overlay">
                  <span className="cv-leader__role">{l.role}</span>
                  <h3 className="cv-leader__name">{l.name}</h3>
                  <span className="cv-leader__cta">View profile <span aria-hidden="true">&rarr;</span></span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 4 · PROJECTS — 3D ring, re-lit band (hidden when the year has none) ══ */}
      {featuredCount > 0 && (
      <section id="work" className="cv2-sect">
        <div data-reveal-sect className="container-x">
          <div className="cv2-head">
            <div className="reveal">
              <p className="cv2-head__eyebrow">Projects</p>
              <h2 className="font-heading text-3xl font-extrabold uppercase leading-[0.95] tracking-tight text-ink md:text-5xl">Our Projects</h2>
            </div>
            <a href="/projects" data-magnetic className="civic-btn">All projects <span aria-hidden="true">&rarr;</span></a>
          </div>
          {/* Curved auto-scrolling arc of project tiles (ux-india style). JS
              (initArcSlider) clones tiles to fill + loop and applies the
              per-tile rotate/lift that forms the concave arc. */}
          <div className="cv-arc" data-arc>
            <div className="cv-arc__track" data-arc-track>
              {featured.map((p) => (
                /* ProjectDetail reads Request.QueryString["pid"] — NOT "id" (?id= lands on
                   "Project Not Found"). Matches AllProjects.aspx / Gallery.aspx. */
                <a key={p.id} href={withYear('/project?pid=' + p.id, club.selectedYearId)} className="cv-arc__item group" title={p.title}>
                  <div className="cv-arc__media">
                    <img src={media(p.img)} alt={p.title} loading="lazy" onError={wheelFallback} />
                    <span className="cv-arc__scrim" aria-hidden="true"></span>
                    <div className="cv-arc__cap">
                      <span className="cv-arc__tag">{p.avenueLabel}</span>
                      <h3 className="cv-arc__title">{p.title}</h3>
                      <span className="cv-arc__more" aria-hidden="true">Read more <span aria-hidden="true">&rarr;</span></span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
            {/* Mobile-only stepper. A phone has no hover, so the ring never
                stops long enough to READ it and pick a project. These hand
                over control: the first press ends the auto-spin for good and
                snaps to the nearest card, then each press turns exactly one.
                MUST sit outside [data-arc-track] — initArcSlider treats every
                track child as a ring card and would spin the buttons too. */}
            <button type="button" className="cv-arc__nav cv-arc__nav--prev" data-arc-prev aria-label="Previous project">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" className="cv-arc__nav cv-arc__nav--next" data-arc-next aria-label="Next project">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </section>
      )}

      {/* ══ 5 · MEETINGS & FELLOWSHIP + NEWSLETTERS (merged, no map) ══ */}
      <section id="events" className="cv2-sect overflow-hidden">
        <div data-reveal-sect className="container-x relative z-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
          {/* Left: meetings & fellowship (glass panel; map removed by request —
               the "View on map" button opens Google Maps externally) */}
          <div className="lg:col-span-5">
            <div id="meet" className="cv2-meet cv2-meet--solo reveal">
              <div>
                <p className="cv2-head__eyebrow">Meetings &amp; fellowship</p>
                <p className="cv2-meet__day">{meetingDay}{meetingTime !== '—' && (<em>{meetingTime}</em>)}</p>
                <p className="cv2-meet__venue">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span>{meetingVenue}</span>
                </p>
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" data-magnetic className="civic-btn mt-7">View on map <span aria-hidden="true">&rarr;</span></a>
              </div>
            </div>
          </div>
          {/* Right: newsletters */}
          <div className="lg:col-span-7">
            <div className="cv2-head reveal">
              <div>
                <h2 className="font-heading text-3xl font-extrabold uppercase leading-[0.95] tracking-tight text-ink md:text-4xl">Newsletters</h2>
              </div>
              <a href="/newsletters" className="civic-btn shrink-0">View all <span aria-hidden="true">&rarr;</span></a>
            </div>
            {newslettersCount === 0 ? (
            <div className="cv2-empty">No newsletter found &mdash; check back soon.</div>
            ) : (
            <div className="cv2-newslist cv-stagger">
              {newsletters.map((n, i) => (
                <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" className="cv2-news reveal">
                  <span className="cv2-news__badge" aria-hidden="true">PDF</span>
                  <span className="min-w-0 flex-1">
                    <span className="cv2-news__title block">{n.title}</span>
                    <span className="cv2-news__date block">{n.date}</span>
                  </span>
                  <span className="cv2-more" aria-hidden="true"><span aria-hidden="true">&rarr;</span></span>
                </a>
              ))}
            </div>
            )}
          </div>
        </div>
      </section>

      {/* ══ 7 · JOIN / CTA — cinematic finale band ══ */}
      <section id="join" className="cv2-cta">
        <div className="cv2-noise" aria-hidden="true"></div>
        <div data-reveal-sect className="container-x">
          <div>
            <p className="cv2-cta__eyebrow reveal">Join us</p>
            <h2><span data-split data-split-stagger="0.03">Become a Rotarian</span><span className="cv2-dot">.</span></h2>
          </div>
          <div>
            <p data-sr>Bring a skill, an hour, or an idea. Start with a meeting and see the work for yourself.</p>
            <div className="cv2-cta__actions reveal">
              <a href={club.adminLoginUrl} target="_blank" rel="noopener noreferrer" data-magnetic className="cv2-btn-light">Login <span aria-hidden="true">&rarr;</span></a>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
