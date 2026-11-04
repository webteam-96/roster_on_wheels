'use client'
// Port of Home.aspx + Home.aspx.cs — the CLASSIC-BLUE home body only.
//
// Home.aspx.cs's OnPreInit Server.Transfers to HomeWarmModern / HomeMadras /
// HomeCivicBold / HomeVerdigrisLedger under the other four themes; App.jsx does
// that switch here, so this file is purely the classic layout.
//
// All the data (banners, ads, stats, featured, meeting info, events,
// newsletters, leaders) comes from HomePageBase.cs, ported once in
// ../shared/homeData.js.
//
// Home.aspx's page-scoped <style> block is carried over as PAGE_CSS below.
//
// Home.aspx.cs also builds QuickLinks (Calendar / Upcoming Events / Newsletters
// / Projects) but the classic markup never renders it — not ported.
import { useEffect, useRef } from 'react'
import { useClub } from '@/site/ClubContext.jsx'
import Squares from '@/themes/shared/components/Squares.jsx'
import WorldMapBg from '@/themes/shared/components/WorldMapBg.jsx'
import { withYear, usePageTitle } from '@/themes/shared/rotaryPage.js'
import { useHomeData, adAnchorProps } from '@/themes/shared/homeData.js'
import { useRotaryAnim } from '@/themes/shared/useRotaryAnim.js'

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

// Home.aspx's page-scoped <style>, verbatim.
const PAGE_CSS = `
        /* The 7fr/3fr hero split leaves the ad box ~100px wide on a phone and ~210px
           on a tablet — too small to read anything in — so the banner and the ad
           stack as two full-width rows on everything below a laptop. 1280 (Tailwind
           xl), not 1024: iPad landscape is 1024 and is still a tablet, while real
           laptops start at 1366. Hand-written rather than an
           xl:grid-cols-[7fr_3fr] utility because rotary-design.css is precompiled
           and an arbitrary-value class used only here would not exist in it. */
        /* start, NOT stretch. Both hero boxes carry an aspect-ratio, and a stretched
           grid item takes the ROW's height and then derives its width from that
           ratio — so the 4:3 ad was already 419px wide inside a 359px column, its
           right edge clipped by the viewport. With start, each box keeps the column
           width and computes its own height. */
        .hero-split { grid-template-columns: 1fr; align-items: start; }
        /* --hero-cols is written by shapeHeroRow() as "<bannerRatio>fr <adRatio>fr".
           Widths in that proportion give BOTH boxes the SAME height while each keeps
           its own image's shape: width = H x ratio, so height = width / ratio = H for
           both. It is a custom property rather than an inline grid-template-columns
           so the single-column mobile rule above still wins below 1280px — an inline
           style would beat this media query and un-stack the phone layout. */
        @media (min-width: 1280px) { .hero-split { grid-template-columns: var(--hero-cols, 7fr 3fr); } }
        /* Both boxes re-shape as the slider advances (clubs upload mixed shapes), so
           ease the change instead of snapping. Browsers without animatable
           aspect-ratio / grid-template-columns simply jump, which is the old
           behaviour. */
        .hero-split { transition: grid-template-columns .45s ease; }
        .hero-split [data-hero-banner], .hero-split [data-hero-ad] { transition: aspect-ratio .45s ease; }
        @media (prefers-reduced-motion: reduce) {
          .hero-split, .hero-split [data-hero-banner], .hero-split [data-hero-ad] { transition: none; }
        }
        /* Slider controls: the markup gives these a white glyph on a translucent
           WHITE pill (bg-white/25) and white dots (bg-white/60), which vanish on a
           light banner — and most club banners are light artwork on white. A dark
           scrim restores contrast on any image without moving or resizing anything.
           Hand-written because this port ships PRECOMPILED Tailwind: bg-black/40 and
           every similar utility is absent from the sheet, so swapping the class
           would silently render a fully transparent button.
           Specificity is 0,1,0 — deliberately BELOW Tailwind's compiled
           hover:bg-gold rule (0,2,0), so the theme's gold hover still wins. */
        [data-hero-prev], [data-hero-next] {
          background-color: rgba(15, 23, 42, .45);
          box-shadow: 0 1px 6px rgba(0, 0, 0, .3);
        }
        [data-hero-dot] { box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); }
`

export default function Home({ data }) {
  const club = useClub()
  // Classic only: 4 most recent projects — its grid has no scroller (GetFeatured).
  // 2 newsletters, not the default 4 (by request 2026-07-29). This column drove
  // the info row's height: 4 items pushed it to ~553px, which left the Meeting and
  // Upcoming Events cards half empty. At 2 the three cards come out near-equal.
  const d = useHomeData(data.home, { featuredTake: 4, newsletterTake: 2 })
  const {
    banners, ads, projectStats, membershipStats, featured, newsletters, events,
    meetingDay, meetingTime, meetingVenue, mapUrl,
    featuredCount, eventsCount, newslettersCount,
  } = d

  usePageTitle(club.clubName)

  useRotaryAnim([d.loading, banners.length, ads.length, featuredCount, eventsCount, newslettersCount, d.leaders.length])

  // Both hero boxes take their OWN image's aspect ratio, and the columns are set
  // to those same ratios — which makes the two boxes exactly as tall as each
  // other while neither image is cropped, letterboxed or blurred.
  //
  // The maths: for a shared height H, an image of ratio r needs width H*r. So if
  // the column widths are in proportion rBanner : rAd, both boxes resolve to the
  // same H. Measured on rcchennaicentralelite: banner 1.67, ad 0.88 -> columns
  // 1.67fr 0.88fr -> banner 861x516 and ad 454x516.
  //
  // ponytail: latches on the FIRST image of each box to decode. A club mixing
  // shapes across its slides gets the first slide's ratio for all of them (the
  // rest then crop) — the same trade-off warm-modern already ships with.
  // Per-slide heights would fix it but would make the strip jump mid-crossfade.
  const rowRef = useRef(null)
  useEffect(() => {
    const row = rowRef.current
    if (!row) return
    const boxes = [row.querySelector('[data-hero-banner]'), row.querySelector('[data-hero-ad]')]
    const ratios = [null, null]
    // Clamp so one freak upload can't produce a 3000px-tall hero or a column so
    // thin the other box collapses. Outside this range the image does crop.
    const clamp = (r) => Math.min(4, Math.max(0.5, r))

    const apply = () => {
      boxes.forEach((box, i) => {
        if (!box || ratios[i] === null) return
        box.classList.remove('aspect-[8/3]', 'aspect-[4/3]')
        box.style.aspectRatio = ratios[i] + ' / 1'
      })
      // Only re-proportion the columns once BOTH are known — with one ratio the
      // split would be meaningless. A club with no ads keeps the 7fr/3fr default.
      if (ratios[0] !== null && ratios[1] !== null) {
        row.style.setProperty('--hero-cols', ratios[0] + 'fr ' + ratios[1] + 'fr')
      }
    }

    // Re-shape to whichever slide is CURRENTLY showing, not just the first one.
    // Clubs upload inconsistently: Thane City View ships 8 banners in 5 different
    // shapes (3.19, 1.68 x4, 1.98, 3.20, 2.67), so locking the box to the first
    // image cropped the others by up to 47%.
    const measure = (box, i) => {
      const slides = [...box.querySelectorAll('[data-hero-slide]')]
      // rotary-anim's show() toggles opacity-100 / opacity-0; before it first
      // runs nothing is marked, so fall back to slide 0.
      const active = slides.find((s) => s.classList.contains('opacity-100')) || slides[0]
      const img = active && active.querySelector('[data-hero-img]')
      if (!img || !img.naturalWidth) return
      const r = clamp(img.naturalWidth / img.naturalHeight)
      if (ratios[i] === r) return          // also stops the observer re-entering
      ratios[i] = r
      apply()
    }

    const cleanups = []
    boxes.forEach((box, i) => {
      if (!box) return
      measure(box, i)
      box.querySelectorAll('[data-hero-slide]').forEach((slide) => {
        // Watch the SLIDES, not the box: apply() rewrites the box's own class
        // list, which would retrigger an observer watching the box.
        const mo = new MutationObserver(() => measure(box, i))
        mo.observe(slide, { attributes: true, attributeFilter: ['class'] })
        cleanups.push(() => mo.disconnect())
      })
      box.querySelectorAll('[data-hero-img]').forEach((img) => {
        const fit = () => measure(box, i)
        img.addEventListener('load', fit)   // also fires after an onerror fallback swaps src
        cleanups.push(() => img.removeEventListener('load', fit))
      })
    })
    return () => { cleanups.forEach((off) => off()) }
  }, [banners, ads])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      {/* ══ Hero: banner slider + advertisement slider ══ */}
      <section className="relative isolate overflow-hidden bg-canvas py-6">
        {/* Light animated grid background — the React Bits "Squares" component
            from the reference app's Hero.jsx. The Web Forms port dropped it
            (vanilla JS couldn't carry a canvas component) and left only the
            static glow below, which is why it stopped animating there. */}
        <Squares className="absolute inset-0 -z-10 h-full w-full" />
        {/* soft warm glow up top */}
        <div className="pointer-events-none absolute left-1/2 top-6 -z-10 h-64 w-[55%] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"></div>
        <div ref={rowRef} className="container-x relative grid gap-5 hero-split">

          {/* Banner slider */}
          {/* The box takes the BANNER'S OWN shape, so the image fills it exactly:
              nothing cropped, and no blurred filler either. 8:3 is only the initial
              value — shapeHero() below overwrites it from the first image that
              decodes.

              Why: the dashboard locks new uploads to 16:5 (3.2:1), but clubs
              onboarded earlier still carry the old 996x596 shape (1.67:1). Measured
              on rcchennaicentralelite (club 31822): all 5 banners are 996-997 x
              596-597, and a fixed 8:3 box with object-cover discarded 37% of each
              image's HEIGHT — the top and bottom sliced off every slide. Letterboxing
              it with object-contain avoided the crop but left a blurred fill on both
              sides, which reads as a defect of its own. Matching the box to the image
              is the only option with neither.

              Ported from HomeWarmModern, minus its width override: this box is a grid
              item in the 7fr column, so only the ASPECT is set and the column keeps
              owning the width. */}
          <div data-hero-banner data-hero data-hero-interval="5000" className="relative aspect-[8/3] overflow-hidden rounded-xl bg-white shadow-card">
            {banners.map((b, i) => {
              const img = (
                <img src={b.src} data-fallbacks={b.fallbacks} data-hero-img alt="Banner" referrerPolicy="no-referrer"
                     onError={(e) => rotaryImgFallback(e.currentTarget)}
                     className="absolute inset-0 h-full w-full object-cover" />
              )
              /* The anchor REPLACES the slide div rather than nesting inside it:
                 rotary-anim.js only sets pointerEvents on [data-hero-slide], so a
                 nested anchor on a hidden slide would still eat the click. */
              return b.url ? (
                <a key={i} href={b.url} {...adAnchorProps(b.url)} aria-label={b.title || 'Open banner link'}
                   data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">{img}</a>
              ) : (
                <div key={i} data-hero-slide className="absolute inset-0 opacity-0 transition-opacity duration-700">{img}</div>
              )
            })}
            <button type="button" data-hero-prev aria-label="Previous slide" className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white backdrop-blur transition hover:bg-gold hover:text-navy">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button type="button" data-hero-next aria-label="Next slide" className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full bg-white/25 p-2 text-white backdrop-blur transition hover:bg-gold hover:text-navy">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div className="rotary-hero-dots absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2">
              {banners.map((_, i) => (
                <button key={i} type="button" data-hero-dot aria-label="Go to slide" className="h-2 w-2 rounded-full bg-white/60 transition-all"></button>
              ))}
            </div>
          </div>

          {/* Advertisement slider — same rule as the banner: the box takes the ad
              image's own shape, so nothing is cropped and the blurred fill is gone.
              4:3 is only the starting value until shapeHeroRow measures the image.
              Measured on rcchennaicentralelite: all 8 ads are 0.88 (portrait), which
              the old 4:3 box letterboxed behind a blur. */}
          <div data-hero-ad data-hero data-hero-interval="4500" className="relative aspect-[4/3] overflow-hidden rounded-xl bg-navy-deep shadow-card">
            {ads.map((ad, i) => (
              <a key={i} href={ad.url} {...adAnchorProps(ad.url)} data-hero-slide
                 className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-700">
                <img src={ad.img} data-fallbacks={ad.fallbacks} data-hero-img alt="Advertisement" referrerPolicy="no-referrer" onError={(e) => rotaryImgFallback(e.currentTarget)} className="absolute inset-0 h-full w-full object-cover" />
              </a>
            ))}
            <div className="rotary-hero-dots absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2">
              {ads.map((_, i) => (
                <button key={i} type="button" data-hero-dot aria-label="Go to advertisement" className="h-2 w-2 rounded-full bg-white/60 transition-all"></button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══ Counters (shown directly; count-up on scroll into view) ══ */}
      <section data-impact className="relative overflow-hidden bg-gradient-to-br from-navy-deep via-navy to-navy-deep py-12 md:py-16" aria-label="Our project impact">
        {/* dotted world-map texture — from the reference app's Counters.jsx. The
            Web Forms port kept only the flat .impact-dots grid below it. */}
        <WorldMapBg color="#ffffff" opacity={0.1} size="cover" />
        <div className="impact-dots pointer-events-none absolute inset-0 opacity-30"></div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-gold/10 blur-3xl"></div>
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-white/5 blur-3xl"></div>
        <div className="pointer-events-none absolute left-1/2 top-0 h-64 w-[60%] -translate-x-1/2 rounded-full bg-gold/[0.07] blur-3xl"></div>
        <div className="container-x relative">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <span className="reveal inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Our Projects</span>
            <h2 className="mt-4 font-heading text-3xl font-extrabold text-white md:text-[2.6rem] md:leading-tight" data-split>Creating Measurable Change</h2>
            <p className="reveal mt-3 text-sm leading-relaxed text-white/70 md:text-base">A snapshot of the difference we&rsquo;ve made together &mdash; real projects, real impact across world.</p>
            <div className="reveal mx-auto mt-5 h-1 w-20 rounded-full bg-gradient-to-r from-gold to-gold-light"></div>
          </div>

          {/* Counters are shown DIRECTLY (by request 2026-08-04) — the count-up
              still animates when the band scrolls into view, via initCounters.
              The reference app gated these behind a "View Our Project Impact"
              button (which is what carried the cta-ring / cta-nudge / cta-wiggle
              animations, and what rotary-anim.js's initImpact() drives). That
              gate is deliberately NOT used here: the figures should be visible
              without a click. To restore it, re-add a [data-impact-cta] button
              and put `hidden` back on this grid. */}
          {/* Two groups: Project impact (4 stats) and Membership (member count). */}
          <div data-impact-grid className="flex flex-col gap-8 md:flex-row md:items-stretch md:gap-5">

            {/* ── Group 1: Project (4 stats, takes 4/5 of the row) — boxed ── */}
            <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5 md:flex-[4]">
              <div className="reveal mb-5 flex items-center justify-center gap-3">
                <span className="h-px w-8 bg-white/10"></span>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Projects</span>
                <span className="h-px w-8 bg-white/10"></span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-4">
                {/* The [data-count] div carries a key of its own VALUE. rotary-anim
                    writes the counted-up number into that div's textContent, but
                    React's vdom still believes the child is the literal "0" it
                    rendered — so on a re-render with new figures React sees "0" ==
                    "0" and never touches the text node, while initCounters'
                    __ra_counter guard blocks a re-animation. The number then stays
                    frozen at the first year's value for the life of the page (that
                    is what "changing the year doesn't change the counters" was).
                    Keying by value forces a fresh node, which re-arms and re-counts.
                    Same fix in HomeWarmModern / HomeCivicBold / ProofDesign. */}
                {projectStats.map((s, i) => (
                  <div key={i} className="group relative transition-transform duration-300 hover:-translate-y-1.5">
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.18] to-white/[0.04] p-px transition-colors duration-300 group-hover:from-gold/60 group-hover:to-gold/10">
                      <div className="relative overflow-hidden rounded-2xl bg-navy/70 px-3 py-6 text-center backdrop-blur-sm">
                        <div className="relative mx-auto mb-4 h-14 w-14">
                          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-light text-navy shadow-lg shadow-gold/30 transition-transform duration-300 group-hover:scale-110"
                               dangerouslySetInnerHTML={{ __html: s.icon }}>
                          </div>
                        </div>
                        <div className="whitespace-nowrap bg-gradient-to-b from-white to-white/70 bg-clip-text font-heading text-base font-extrabold leading-none tracking-tight tabular-nums text-transparent sm:text-[22px] xl:text-2xl"
                             key={s.value + '|' + s.placeholder}
                             data-count={s.value} data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                        <div className="mx-auto mt-2.5 h-px w-8 bg-gold/50 transition-all duration-300 group-hover:w-12"></div>
                        <div className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/65">{s.label}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Group 2: Membership (member count, takes 1/5 of the row) — boxed ── */}
            <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5 md:flex-1">
              <div className="reveal mb-5 flex items-center justify-center gap-3">
                <span className="h-px w-8 bg-white/10"></span>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Membership</span>
                <span className="h-px w-8 bg-white/10"></span>
              </div>
              <div className="mx-auto w-full max-w-[240px] md:max-w-none">
                {membershipStats.map((s, i) => (
                  <div key={i} className="group relative transition-transform duration-300 hover:-translate-y-1.5">
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.18] to-white/[0.04] p-px transition-colors duration-300 group-hover:from-gold/60 group-hover:to-gold/10">
                      <div className="relative overflow-hidden rounded-2xl bg-navy/70 px-3 py-6 text-center backdrop-blur-sm">
                        <div className="relative mx-auto mb-4 h-14 w-14">
                          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-light text-navy shadow-lg shadow-gold/30 transition-transform duration-300 group-hover:scale-110"
                               dangerouslySetInnerHTML={{ __html: s.icon }}>
                          </div>
                        </div>
                        <div className="whitespace-nowrap bg-gradient-to-b from-white to-white/70 bg-clip-text font-heading text-base font-extrabold leading-none tracking-tight tabular-nums text-transparent sm:text-[22px] xl:text-2xl"
                             key={s.value + '|' + s.placeholder}
                             data-count={s.value} data-count-prefix={s.prefix} data-count-text={s.placeholder}>0</div>
                        <div className="mx-auto mt-2.5 h-px w-8 bg-gold/50 transition-all duration-300 group-hover:w-12"></div>
                        <div className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/65">{s.label}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Hide the entire Projects section when the selected year has no projects. */}
      {featuredCount > 0 && (
      <>
      {/* ══ Featured projects ══ */}
      <section className="bg-mesh bg-canvas py-12">
        <div className="container-x">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-xl font-bold text-navy sm:text-2xl" data-split>Projects</h3>
            <a href="/projects" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-gold hover:text-navy">View All Projects
              <svg className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p) => (
              <article key={p.id} className="reveal h-full">
                <a href={withYear('/project?pid=' + p.id, club.selectedYearId)} className="block h-full">
                  <div className="spotlight-card group flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-card transition-all hover:-translate-y-1.5 hover:shadow-cardHover">
                    <div className="img-zoom relative h-40 bg-navy/5">
                      <img src={p.img} alt={p.title} className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                      <span className={'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow ' + p.avenueColor}>{p.avenueLabel}</span>
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h4 className="line-clamp-2 font-heading text-[15px] font-bold leading-snug text-navy">{p.title}</h4>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{p.desc}</p>
                      <div className="mt-auto pt-3">
                        <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-navy px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition-all group-hover:bg-gold group-hover:text-navy">Read More
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>
      </>
      )}

      {/* ══ Info row: meeting / events / newsletters ══ */}
      <section className="bg-canvas py-14">
        <div className="container-x grid gap-6 lg:grid-cols-3">
          {/* Meeting info */}
          <div className="reveal h-full">
            {/* Map embed REMOVED by request (2026-07-29): the card is now a flex column so
                the info rows take the slack (flex-1) and "View on Map" still anchors to the
                bottom edge, keeping this column flush with the Events/Newsletters cards
                instead of leaving dead navy space where the iframe used to be.
                MapEmbedUrl is no longer read here - MapUrl still powers the button. */}
            <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-card">
              <img src="/images/logo/wheel.png" alt="" className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 opacity-[0.06]" />
              <div className="relative flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-gold"><svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
                <h3 className="font-heading text-lg font-bold">Meeting <span className="text-gold">Information</span></h3>
              </div>
              <div className="mt-3 h-1 w-12 shrink-0 rounded-full bg-gold"></div>
              {/* flex-1 + justify-center: this column is grid-stretched to match the tallest
                  card in the row, which varies a lot (empty state ~352px, a populated event
                  card ~510px). Centring keeps Day/Time/Venue as one tight block with even
                  space above and below instead of stranding it at the top. Do NOT use
                  justify-between here - it strands the three rows far apart. */}
              <div className="relative mt-5 flex flex-1 flex-col justify-center space-y-4 text-sm">
                <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span><div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-white/55">Day</p><p className="font-semibold leading-snug">{meetingDay}</p></div></div>
                <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-white/55">Time</p><p className="font-semibold leading-snug">{meetingTime}</p></div></div>
                <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold"><svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span><div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-white/55">Venue</p><p className="font-semibold leading-snug">{meetingVenue}</p></div></div>
              </div>
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="relative mt-5 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gold py-3 text-sm font-bold uppercase tracking-wide text-navy shadow-lg shadow-gold/20 transition hover:bg-gold-light">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg> View on Map
              </a>
            </div>
          </div>

          {/* Recent events */}
          <div className="reveal h-full">
            <div className="flex h-full flex-col rounded-2xl bg-white p-6 shadow-card">
              <div className="mb-5"><h3 className="font-heading text-lg font-bold text-navy">Upcoming Events</h3><div className="mt-2 h-1 w-12 rounded-full bg-gold"></div></div>
              {eventsCount === 0 ? (
              <>
              {/* Flat illustration empty state (per reference supplied 2026-08-03, ported
                  from HomeWarmModern.aspx's shipped version). This card is a narrow
                  ~1/3-width grid column (unlike warm-modern's wide 7-of-12 column), so
                  it's a STACKED/vertical centered layout, not warm's side-by-side
                  sm:flex-row. Illustration sized down (w-36 vs warm's w-44/w-52) to fit.
                  No min-h on the container - let content set natural height, matching
                  flex-1 + justify-center from the Meeting Info card above for row-stretch
                  centering. */}
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-navy/15 bg-white/60 px-6 py-5 text-center">
                <svg className="h-auto w-24" width="200" height="164" viewBox="0 0 200 164" fill="none" aria-hidden="true">
                  {/* soft asymmetric backdrop (two overlapping ellipses, not a single perfect oval) */}
                  <ellipse cx="104" cy="96" rx="92" ry="58" fill="#F7A600" fillOpacity="0.08"/>
                  <ellipse cx="82" cy="80" rx="58" ry="46" fill="#F5A623" fillOpacity="0.06"/>
                  {/* sparkles */}
                  <g fill="#F7A600" fillOpacity="0.5">
                    <path d="M176 46l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/>
                    <path d="M20 92l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/>
                    <path d="M118 16l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                  </g>
                  {/* pot + plant, pointed petal-shaped leaves */}
                  <path d="M28 130h34l-5 24a4 4 0 0 1-4 3H37a4 4 0 0 1-4-3l-5-24Z" fill="#F5A623"/>
                  <rect x="24" y="124" width="42" height="9" rx="4" fill="#0A2472"/>
                  <path d="M45 124C18 112 14 78 22 58 46 70 47 104 45 124Z" fill="#F7A600" fillOpacity="0.88"/>
                  <path d="M45 124C64 106 70 76 56 54 46 74 44 102 45 124Z" fill="#0A2472" fillOpacity="0.7"/>
                  <path d="M45 124C38 100 40 78 45 62 52 82 50 106 45 124Z" fill="#F5A623" fillOpacity="0.95"/>
                  {/* calendar */}
                  <rect x="76" y="40" width="104" height="108" rx="14" fill="#fff" stroke="#0A2472" strokeWidth="3.5"/>
                  <path d="M76 54a14 14 0 0 1 14-14h76a14 14 0 0 1 14 14v16H76V54Z" fill="#F7A600"/>
                  <line x1="102" y1="24" x2="102" y2="46" stroke="#0A2472" strokeWidth="3.5" strokeLinecap="round"/>
                  <circle cx="102" cy="22" r="6" fill="#fff" stroke="#0A2472" strokeWidth="3.5"/>
                  <line x1="154" y1="24" x2="154" y2="46" stroke="#0A2472" strokeWidth="3.5" strokeLinecap="round"/>
                  <circle cx="154" cy="22" r="6" fill="#fff" stroke="#0A2472" strokeWidth="3.5"/>
                  <g fill="#F5A623" fillOpacity="0.3">
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
                <div className="flex flex-col items-center">
                  <h4 className="mt-2 font-heading text-lg font-extrabold leading-tight text-navy">No Upcoming Events</h4>
                  <div className="mt-2 h-1 w-10 rounded-full bg-gold"></div>
                  {/* The "We're working on something exciting…" blurb was removed by
                      request: it padded the empty Upcoming Events card and pushed the
                      Meeting Information row taller than its content needed. */}
                  {/* The empty state used to carry its own "View All Events" link here,
                      which duplicated the full-width one at the bottom of the card —
                      two identical buttons stacked whenever a club had no events.
                      Removed by request; the bottom one is kept because it shows in
                      BOTH states. */}
                </div>
              </div>
              </>
              ) : (
              <>
              {/* Featured single upcoming event as a card (not a list) - the source is
                  HomePageBase.GetUpcomingEventCards(), which is already .Take(1), so this
                  repeater can only ever emit ONE card. Whole card links to the event's OWN
                  detail page; a bundled meeting photo fills in when the event has no image.

                  SIZED TO FIT THE ROW (2026-07-29, by request): with the Meeting map gone
                  the row is ~352px, which leaves only ~185px here between the heading and
                  the "View All Events" button. The old h-44 (176px) photo alone ate that,
                  forcing the row back to ~510px and re-opening a gap in the Meeting card.
                  So: photo h-24, badge h-12, body p-3, title text-sm, date+time on ONE line
                  and venue clamped to 1 line. Measured result: row stays 357px.
                  If you enlarge the photo again, expect the whole row to grow with it. */}
              {/* The flex-1 slack absorber lives on THIS wrapper, not on the card <a>.
                  The column is grid-stretched to the tallest card in the row (Newsletters
                  with 4 items makes it ~553px), and if the bordered <a> carried flex-1 it
                  stretched into a tall empty box under the event. The wrapper takes the
                  slack instead, so the card hugs its content AND the three "View All"
                  buttons still bottom-align. Don't move flex-1 back onto the <a>. */}
              <div className="flex-1">
                {events.map((ev) => (
                  <a key={ev.id} href={'/event?id=' + ev.id} className="group flex flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-cardHover">
                    {/* WHOLE photo, unchanged row height. The box is a 374x96 strip
                        (h-24 is the 2026-07-29 sizing request, and growing it regrows
                        the whole row), while event photos are 4:3 — plain object-cover
                        was cutting 66% off the top and bottom. object-contain shows all
                        of it; the WHITE sits on the img itself, not the wrapper, so the
                        letterbox is white while the wrapper's tint still backs the
                        placeholder when a photo is missing. (A blurred fill was tried
                        here first and rejected — white by request.) */}
                    <div className="img-zoom relative h-24 overflow-hidden bg-navy/5">
                      <img src={ev.img} alt={ev.title} className="h-full w-full bg-white object-contain" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/images/event/e-2.jpg' }} />
                      <div className="absolute inset-0 bg-gradient-to-t from-navy/55 via-transparent to-transparent"></div>
                      <div className="absolute left-3 top-3 flex h-12 w-12 flex-col items-center justify-center rounded-xl bg-navy/90 text-gold shadow-lg ring-1 ring-white/15 backdrop-blur-sm">
                        <span className="text-[10px] font-bold uppercase leading-none">{ev.mon}</span>
                        <span className="font-heading text-lg font-extrabold leading-none">{ev.day}</span>
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col p-3">
                      <h4 className="line-clamp-2 font-heading text-sm font-bold leading-snug text-navy transition-colors duration-300 group-hover:text-gold-cta">{ev.title}</h4>
                      {/* Date and time share ONE line here (they were two stacked <p> before).
                          That saves ~22px, which is what lets the card fit the 185px slot. */}
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-black">
                        <svg className="h-3.5 w-3.5 shrink-0 text-gold-cta" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        <span className="line-clamp-1">{ev.date}{!ev.time || !ev.time.trim() ? '' : ' · ' + ev.time}</span>
                      </p>
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
                        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span className="line-clamp-1">{ev.venue}</span>
                      </p>
                    </div>
                  </a>
                ))}
              </div>
              </>
              )}
              <a href="/events" className="group mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-navy to-navy-deep py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-navy/20 transition-all hover:-translate-y-0.5 hover:from-gold hover:to-gold-light hover:text-navy">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> View All Events
              </a>
            </div>
          </div>

          {/* Latest newsletters */}
          <div className="reveal h-full">
            <div className="flex h-full flex-col rounded-2xl bg-white p-6 shadow-card">
              <div className="mb-5"><h3 className="font-heading text-lg font-bold text-navy">Newsletters</h3><div className="mt-2 h-1 w-12 rounded-full bg-gold"></div></div>
              {newslettersCount === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-navy/5 text-navy">
                  <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <p className="text-sm font-semibold text-navy">No newsletter found</p>
                <p className="max-w-[16rem] text-xs text-muted">Newsletters will appear here once published.</p>
              </div>
              ) : (
              <ul className="flex-1 divide-y divide-gray-100">
                {newsletters.map((n, i) => (
                  <li key={i} className="group/item -mx-2 flex gap-4 rounded-xl px-2 py-3.5 transition-colors duration-300 hover:bg-navy/[0.035]">
                    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-navy text-gold shadow-sm transition-all duration-300 group-hover/item:rotate-3 group-hover/item:scale-110 group-hover/item:bg-gold group-hover/item:text-navy">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span className="mt-0.5 text-[9px] font-bold">PDF</span>
                    </div>
                    <div className="min-w-0">
                      <h4 className="line-clamp-1 font-semibold leading-snug text-navy transition-colors duration-300 group-hover/item:text-gold-cta">{n.title}</h4>
                      <p className="text-xs text-muted">{n.date}</p>
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="group mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-gold-cta transition-colors hover:bg-gold hover:text-navy">Read Online
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
              )}
              <a href="/newsletters" className="group mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-navy to-navy-deep py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-navy/20 transition-all hover:-translate-y-0.5 hover:from-gold hover:to-gold-light hover:text-navy">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> View All Newsletters
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ══ Dignitaries & Leaders ══ */}
      <section className="bg-dotgrid bg-canvas py-14">
        <div className="container-x">
          <div className="mb-12 text-center">
            <p className="label-eyebrow mb-2">Our Leadership</p>
            <h2 className="font-heading text-3xl font-extrabold text-navy" data-split>Dignitaries &amp; Leaders</h2>
            <div className="reveal reveal-zoom mx-auto mt-3 h-1 w-24 rounded-full bg-gold"></div>
          </div>
          {/* 4-up only from xl. container-x is max-w-[1400px] with 32px sides, so
              between lg and xl four cards leave each one just 174px of content —
              no readable type fits a role on one line there. Two-up gives 420px. */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-24 pt-24 sm:grid-cols-2 xl:grid-cols-4">
            {d.leaders.map((l) => (
              <div key={l.type} className="reveal h-full">
                <div className="spotlight-card group relative flex h-full flex-col rounded-2xl border border-white/15 bg-navy px-6 pb-7 pt-16 text-center shadow-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5">
                  <span className="pointer-events-none absolute inset-[5px] rounded-[14px] border border-white/15"></span>
                  <span className="pointer-events-none absolute inset-x-8 top-[5px] h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent"></span>
                  <span className="glare"></span>
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[65%]">
                    <div className="avatar-ring relative isolate h-[124px] w-[124px] rounded-full p-[3px]">
                      <img src={l.img} alt={l.name} onError={(e) => { e.currentTarget.src = '/img/profile_pic.png' }} className="h-full w-full rounded-full border-2 border-white object-cover shadow-lg transition-transform duration-500 group-hover:-translate-y-1 group-hover:scale-105" />
                      <span className="absolute bottom-1 left-0 flex h-9 w-9 items-center justify-center rounded-full bg-navy shadow-md ring-2 ring-white transition-transform duration-700 ease-out group-hover:rotate-[360deg]">
                        <img src="/images/logo/wheel.png" alt="" className="h-6 w-6 object-contain" />
                      </span>
                    </div>
                  </div>
                  <h3 className="relative font-heading text-lg font-bold text-white transition-colors duration-300 group-hover:text-gold-light"><span className="shiny-text">{l.name}</span></h3>
                  <p className="relative mt-2 truncate text-[11px] font-semibold tracking-wide text-gold" title={l.role}>{l.role}</p>
                  {/* mt-auto pushes the divider + button to the bottom so every card lines up even when the name or role wraps to two lines. */}
                  <div className="relative mt-auto">
                    <span className="mx-auto mt-5 block h-px w-10 bg-gold/30"></span>
                    <a href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)} className="btn group/btn relative mt-4 rounded-full border border-gold/60 bg-transparent px-5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-light transition-colors duration-300 hover:border-gold hover:bg-gold hover:text-navy">View Profile
                      <svg className="h-3.5 w-3.5 transition-transform duration-300 group-hover/btn:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
