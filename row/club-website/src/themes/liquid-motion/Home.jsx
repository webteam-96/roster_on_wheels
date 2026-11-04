'use client'
// ─────────────────────────────────────────────────────────────────────────────
// LIQUID MOTION — home. The approved sample (Theme8-Samples/E-liquid-webgl)
// ported onto useHomeData, section for section:
//   hero (the banners, sliding by themselves through a liquid wipe - shown whole,
//   never cropped; no club name on show and no marquee, client 2026-09-29)
//   leadership (paper, "Read more" per leader) · the figures, titled "Our impact" (azure)
//   our projects (ink, liquid photos, "Read more" per project) · one gold row: next
//   event, newsletters, where we meet. The club's ads open as a popup. No about
//   section and no "Rotary year" above the titles (client, 2026-09-28).
// Every section is fed by live data and hides (or shows a designed empty
// state) when a club has none of it. Sample-only content with no generic
// source (Thane Hills' foundation, annual projects, landmark list) is dropped;
// the about card lists facts every club has instead.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useClub, useHomeData, usePageTitle, withYear, adAnchorProps, formatMoney, groupInt, plainText } from '../_shared/data.js'
import {
  Band, SectionHead, Figures, ProjectCard, PersonRow, Pill, EmptyState, Arrow, ArrowLeft, ArrowOut, CloseIco,
  pad2, clean, imgFallback, isPlaceholderPhoto,
} from './kit.jsx'
import { useScene, usePageMotion, gsap, onRevert, prefersReducedMotion, lockScroll } from './motion.js'
import './home.css'

const SLIDE_MS = 6000 // the banner dwell; also the track's CSS animation length (home.css liqTrack)

// the banner wipe: a wavy polygon edge crossing left to right (t 0..1)
const wave = (t) => {
  const a = 0.09, e = t * (1 + 2 * a) - a, pts = []
  for (let k = 0; k <= 8; k++) pts.push(((e + a * Math.sin(k * 0.9 + t * 7)) * 100).toFixed(2) + '% ' + (k * 12.5) + '%')
  return 'polygon(0% 0%, ' + pts.join(', ') + ', 0% 100%)'
}

// ── small line icons for the gold row (same stroke as the kit's) ──
const ico = (d) => function Ico() {
  return <svg className="liq-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
const ClockIco = ico('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2')
const PinIco = ico('M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z')
const DocIco = ico('M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6')

// ── the club's advertisements: a popup each time the home opens (a reload included), as in cinematic ──
const AD_MS = 5000
function AdPopup({ ads, clubId }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  const n = ads.length

  // never over the open burger menu (Esc and the scroll lock belong to it then): wait until it closes
  useEffect(() => {
    if (!n) return undefined
    let t = 0
    const arm = (ms) => { t = setTimeout(() => (document.documentElement.classList.contains('liq-menu-open') ? arm(400) : setOpen(true)), ms) }
    arm(2600)
    return () => clearTimeout(t)
  }, [n, clubId])

  // native modal: Esc, focus kept inside (it starts on the close button), focus returns after
  useEffect(() => {
    const dlg = ref.current
    if (!open || !dlg) return undefined
    const back = document.activeElement
    if (!dlg.open) dlg.showModal()
    lockScroll(true)
    return () => {
      lockScroll(false)
      if (back && back.isConnected && back.focus) back.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open || n < 2 || hold || prefersReducedMotion()) return undefined
    const t = setInterval(() => setI((k) => (k + 1) % n), AD_MS)
    return () => clearInterval(t)
  }, [open, n, hold])

  if (!n || !open) return null
  const k0 = i % n
  const a = ads[k0]
  const name = a.title || 'Advertisement ' + (k0 + 1)
  const linked = a.url && a.url !== '#'
  const img = <img key={a.img} className="liq-adpop__img" src={a.img} data-fallbacks={a.fallbacks} alt={linked ? '' : name} decoding="async" onError={imgFallback} />
  const close = () => setOpen(false)
  return (
    <dialog ref={ref} className="liq-adpop" aria-label="Advertisement" onClose={close} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <button type="button" className="liq-adpop__x" onClick={close}><CloseIco /><span className="liq-sr">Close advertisement</span></button>
      <div className="liq-adpop__in" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
        <div className="liq-adpop__frame">
          {linked ? <a className="liq-adpop__link" href={a.url} {...adAnchorProps(a.url)}>{img}<span className="liq-sr">{name} (opens in new tab)</span></a> : img}
        </div>
        {n > 1 ? (
          <div className="liq-adpop__ctrl" role="group" aria-label="Advertisements">
            <button type="button" className="liq-adpop__step" onClick={() => setI((k) => (k - 1 + n) % n)}><ArrowLeft /><span className="liq-sr">Previous advertisement</span></button>
            {ads.map((x, k) => (
              <button key={k} type="button" className="liq-dot" aria-current={k === k0 ? 'true' : 'false'} onClick={() => setI(k)}>
                <span className="liq-sr">Show advertisement {k + 1}</span>
              </button>
            ))}
            <button type="button" className="liq-adpop__step" onClick={() => setI((k) => (k + 1) % n)}><Arrow /><span className="liq-sr">Next advertisement</span></button>
          </div>
        ) : null}
      </div>
    </dialog>
  )
}

export default function Home({ data }) {
  const club = useClub()
  const d = useHomeData(data.home, { featuredTake: 6, newsletterTake: 4 })
  usePageTitle(club.clubDisplayName)

  const rootRef = useRef(null), heroRef = useRef(null), stageRef = useRef(null)
  const swipeX = useRef(null)

  const clubName = club.clubDisplayName

  const leaders = d.leaders.filter((l) => l.name && l.name !== 'Not available')
  const members = d.membershipStats[0] ? d.membershipStats[0].value : 0
  const has = (v) => v && v !== '—'
  const day = has(d.meetingDay) ? clean(d.meetingDay) : ''
  const time = has(d.meetingTime) ? clean(d.meetingTime) : ''
  const venue = has(d.meetingVenue) ? clean(d.meetingVenue) : ''
  const hasMeet = !!(day || time || venue)

  const n = d.impactNumbers
  const figs = [   // order (client, 2026-10-28): projects, cost, beneficiaries, man-hours, members
    ['Projects', n.projects, false],
    ['Total cost', n.totalCost, true],
    ['Beneficiaries', n.beneficiaries, false],
    ['Man-hours', n.manHours, false],
    ['Members', members, false],
  ].filter(([, v]) => v > 0).map(([label, v, money]) => ({ label, value: money ? formatMoney(v, d.currency) : groupInt(v, d.currency) }))

  const ads = d.ads.filter((a) => a.img && !/ClubAdvirtisment\.png$/i.test(a.img))
  const news = d.newsletters.filter((x) => x.url)
  const ev = d.events[0]
  const banners = d.banners
  const N = banners.length
  const bannerKey = banners.map((b) => b.src).join('|')

  // ── the banner slideshow: `cur` shows, `prev` stays under it while the wipe runs.
  //    The track's CSS animation is the timer (its end advances), so hover, keyboard
  //    focus and the pause button all pause it in CSS; reduced motion: no autoplay. ──
  const [slide, setSlide] = useState({ key: '', cur: 0, prev: -1 })
  const [paused, setPaused] = useState(false)
  const [auto] = useState(() => !prefersReducedMotion())
  const cur = slide.key === bannerKey ? Math.min(slide.cur, Math.max(0, N - 1)) : 0
  const prev = slide.key === bannerKey ? slide.prev : -1
  const go = (k) => {
    const next = ((k % N) + N) % N
    if (N > 1 && next !== cur) setSlide({ key: bannerKey, cur: next, prev: cur })
  }

  // the incoming banner wipes in over the outgoing one (layout effect: clipped before its first frame)
  useLayoutEffect(() => {
    const el = prev >= 0 && stageRef.current ? stageRef.current.children[cur] : null
    if (!el) return undefined
    const done = () => setSlide((s) => (s.prev < 0 ? s : { ...s, prev: -1 }))
    if (prefersReducedMotion()) { done(); return undefined }
    const img = el.querySelector('.liq-stage__img')
    const st = { t: 0 }
    const draw = () => { el.style.clipPath = wave(st.t); if (img) img.style.transform = 'scale(' + (1.1 - 0.1 * st.t).toFixed(4) + ')' }
    draw()
    const tw = gsap.to(st, { t: 1, duration: 1.3, ease: 'power2.inOut', onUpdate: draw, onComplete: done })
    return () => { tw.kill(); el.style.clipPath = ''; if (img) img.style.transform = '' }
  }, [cur, prev])

  // ── the standard layer: reveals, rules, odometers, name fills, ink-in words, big-title sweep, liquid photos ──
  const dataKey = [d.loading, d.featured.length, leaders.length, figs.length, news.length, !!ev, hasMeet].join()
  usePageMotion(rootRef, [dataKey])

  // ── the banner stage opens with a wipe up (once per banner set) ──
  useScene(heroRef, () => {
    if (d.loading || !N) return
    const stage = stageRef.current
    const st = { intro: 0 }
    const apply = () => { stage.style.clipPath = st.intro >= 1 ? '' : 'inset(' + ((1 - st.intro) * 100).toFixed(2) + '% 0% 0% 0% round var(--liq-r))' }
    apply()
    const tl = gsap.timeline({ delay: 0.2 }).to(st, { intro: 1, duration: 1.7, ease: 'power3.inOut', onUpdate: apply })
    const meta = heroRef.current.querySelector('.liq-hero__meta')
    if (meta) tl.fromTo(meta, { opacity: 0 }, { opacity: 1, duration: 0.8, clearProps: 'opacity' }, 0.7)
    onRevert(() => { stage.style.clipPath = '' })
  }, [d.loading, bannerKey])

  // ── the rest of the home's scroll work ──
  useScene(rootRef, (c) => {
    if (d.loading) return
    const figs = rootRef.current.querySelector('.liq-numbers')
    if (figs) {
      gsap.fromTo('.liq-glow--a', { yPercent: -25, xPercent: -10 }, { yPercent: 30, xPercent: 12, ease: 'none', scrollTrigger: { trigger: figs, start: 'top bottom', end: 'bottom top', scrub: true } })
      gsap.fromTo('.liq-glow--b', { yPercent: 20 }, { yPercent: -30, ease: 'none', scrollTrigger: { trigger: figs, start: 'top bottom', end: 'bottom top', scrub: true } })
    }
    // leadership portraits rise out of their rows
    gsap.utils.toArray('.liq-people .liq-person').forEach((p) => {
      const pic = p.querySelector('.liq-person__pic')
      const img = pic && pic.querySelector('img')
      if (pic) gsap.fromTo(pic, { yPercent: 22 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: p, start: 'top bottom', end: 'clamp(top 45%)', scrub: true } })
      if (img) gsap.fromTo(img, { scale: 1.35 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: p, start: 'top bottom', end: 'clamp(top 40%)', scrub: true } })
    })
  }, [dataKey])

  return (
    <div className="liq-home" ref={rootRef}>
      <section className={'liq-hero' + (paused ? ' liq-is-paused' : '')} aria-labelledby="liq-hero-h" ref={heroRef}>
        {/* no club name on show (client, 2026-09-29); the page keeps its one heading for screen readers */}
        <h1 className="liq-sr" id="liq-hero-h">{clubName}</h1>
        <div className="liq-stage" ref={stageRef} role="region" aria-label="Banners"
             onPointerDown={(e) => { swipeX.current = e.pointerType === 'mouse' ? null : e.clientX }}
             onPointerCancel={() => { swipeX.current = null }}
             onPointerUp={(e) => {
               const dx = swipeX.current == null ? 0 : e.clientX - swipeX.current
               swipeX.current = null
               if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1))
             }}>
          {banners.map((b, i) => {
            const alt = b.title || clubName + ' banner ' + (i + 1) + ' of ' + N
            const cls = 'liq-stage__slide' + (i === cur ? ' liq-is-on' : i === prev ? ' liq-is-prev' : '')
            const img = (
              <>
                <img className="liq-stage__bg" src={b.src} data-fallbacks={b.fallbacks} alt="" aria-hidden="true" loading={i ? 'lazy' : 'eager'} decoding="async" onError={imgFallback} />
                <img className="liq-stage__img" src={b.src} data-fallbacks={b.fallbacks} alt={alt} width="1920" height="720"
                     loading={i ? 'lazy' : 'eager'} fetchpriority={i ? undefined : 'high'} decoding="async" onError={imgFallback} />
              </>
            )
            return b.url
              ? <a key={b.src + i} className={cls} href={b.url} {...adAnchorProps(b.url)}>{img}<span className="liq-sr"> (opens in new tab)</span></a>
              : <div key={b.src + i} className={cls}>{img}</div>
          })}
        </div>
        {N > 1 ? (
          <div className="liq-hero__meta">
            {/* dots only (client, 2026-10-06): no "01 / 05" and no visible progress line - the line's animation still
                times the autoplay (onAnimationEnd), so it stays in the page, invisible */}
            <span className="liq-hero__track is-silent" aria-hidden="true">
              {auto ? <i key={bannerKey + cur} style={{ animationDuration: SLIDE_MS + 'ms' }} onAnimationEnd={() => go(cur + 1)} /> : null}
            </span>
            <div className="liq-hero__ctrl" role="group" aria-label="Banner slideshow">
              {banners.map((b, i) => (
                <button key={i} type="button" className="liq-dot" aria-current={i === cur ? 'true' : 'false'} onClick={() => go(i)}>
                  <span className="liq-sr">Show banner {i + 1}</span>
                </button>
              ))}
              {/* no Pause button on the banner (client, 2026-10-06); hover / focus still hold it, reduced motion never autoplays */}
            </div>
          </div>
        ) : null}
      </section>


      {d.loading ? null : (
        <>
          {leaders.length ? (
            <Band tone="paper" className="liq-people" aria-labelledby="liq-people-h">
              <SectionHead title="Leadership" id="liq-people-h" />
              <ul className="liq-roll">
                {leaders.map((l) => (
                  <PersonRow key={l.type} name={l.name} role={l.role} img={isPlaceholderPhoto(l.img) ? '' : l.img} bio={plainText(l.bio)}
                             href={withYear('/dignitary?Type=' + l.type, club.selectedYearId)} more />
                ))}
              </ul>
            </Band>
          ) : null}

          {figs.length ? (
            <Band tone="azure" bleed className="liq-numbers" aria-labelledby="liq-figs-h">
              <div className="liq-numbers__bg" aria-hidden="true"><span className="liq-glow liq-glow--a" /><span className="liq-glow liq-glow--b" /></div>
              <div className="liq-wrap">
                <h2 className="liq-h2 liq-numbers__h liq-rv" id="liq-figs-h">Our impact</h2>
                <Figures items={figs} />
              </div>
            </Band>
          ) : null}

          <Band tone="ink" className="liq-projects" aria-labelledby="liq-proj-h">
            <SectionHead big={['Our', 'projects']} id="liq-proj-h" />
            {d.featured.length ? (
              <div className="liq-pgrid">
                {d.featured.map((p, i) => (
                  <ProjectCard key={p.id} href={withYear('/project?pid=' + p.id, club.selectedYearId)} title={p.title} img={p.img}
                               avenue={p.avenueLabel} desc={p.desc} n={i + 1} portrait={i % 4 === 1 || i % 4 === 2} more />
                ))}
              </div>
            ) : (
              <EmptyState as="h3" title="No projects published yet" text="Projects the club publishes for this Rotary year will appear here." />
            )}
            <div className="liq-projects__end"><Pill href="/projects" variant="light">All projects</Pill></div>
          </Band>

          {/* one gold row (client, 2026-09-28): the next event on an ink panel (the one loud thing),
              the newsletters and the meeting flat on the gold, split by hairlines */}
          <Band tone="gold" className="liq-trio">
            <div className="liq-trio__row">
              <section className="liq-trio__col liq-trio__col--event" aria-labelledby="liq-next-h">
                <div className="liq-trio__head">
                  <h2 className="liq-trio__h liq-rv" id="liq-next-h">Upcoming event</h2>
                  {ev ? <a className="liq-trio__all liq-rv" href="/events">All events</a> : null}
                </div>
                {ev ? (
                  <article className="liq-up liq-rv">
                    <p className="liq-up__date"><b aria-hidden="true">{ev.day}</b><span aria-hidden="true">{ev.mon} {ev.year}</span><span className="liq-sr">{ev.date || [ev.day, ev.mon, ev.year].join(' ')}</span></p>
                    <div className="liq-up__body">
                      <h3 className="liq-up__t"><a href={'/event?id=' + ev.id}>{clean(ev.title)}</a></h3>
                      <ul className="liq-icons">
                        {ev.time ? <li><ClockIco /><span className="liq-sr">Time: </span>{ev.time}</li> : null}
                        {ev.venue ? <li><PinIco /><span className="liq-sr">Venue: </span>{clean(ev.venue)}</li> : null}
                      </ul>
                      <Pill href={'/event?id=' + ev.id} variant="light" className="liq-up__go">View event<span className="liq-sr">: {clean(ev.title)}</span></Pill>
                    </div>
                  </article>
                ) : (
                  <div className="liq-trio__empty liq-rv">
                    <p>No events are scheduled yet. New ones appear here as the club adds them.</p>
                    <Pill href="/calendar" variant="light">Open the calendar</Pill>
                  </div>
                )}
              </section>

              {news.length ? (
                <section className="liq-trio__col" aria-labelledby="liq-news-h">
                  <div className="liq-trio__head">
                    <h2 className="liq-trio__h liq-rv" id="liq-news-h">Newsletters</h2>
                    <a className="liq-trio__all liq-rv" href="/newsletters">All newsletters</a>
                  </div>
                  <ul className="liq-issues">
                    {news.map((x, i) => (
                      <li className="liq-rv" key={x.url + i}>
                        <a className="liq-issue" href={x.url} target="_blank" rel="noopener noreferrer">
                          <span className="liq-issue__ico" aria-hidden="true"><DocIco /></span>
                          <span className="liq-issue__t">{clean(x.title) || 'Newsletter'}</span>
                          {x.date ? <span className="liq-issue__d">{x.date}</span> : null}
                          <span className="liq-issue__go" aria-hidden="true"><ArrowOut /></span>
                          <span className="liq-sr"> (PDF, opens in new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {hasMeet ? (
                <section className="liq-trio__col liq-meet" aria-labelledby="liq-meet-h">
                  <div className="liq-trio__head">
                    <h2 className="liq-trio__h liq-rv" id="liq-meet-h">Where we meet</h2>
                  </div>
                  {day ? <p className="liq-meet__day liq-rv">{day}</p> : null}
                  <ul className="liq-icons">
                    {time ? <li className="liq-rv"><ClockIco /><span className="liq-sr">Time: </span>{time}</li> : null}
                    {venue ? <li className="liq-rv"><PinIco /><span className="liq-sr">Venue: </span>{venue}</li> : null}
                  </ul>
                  {venue ? <Pill href={d.mapUrl} variant="ink" external className="liq-rv">Get directions</Pill> : null}
                </section>
              ) : null}
            </div>
          </Band>
        </>
      )}

      {d.loading ? null : <AdPopup ads={ads} clubId={club.clubId} />}
    </div>
  )
}
