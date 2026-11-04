'use client'
// ─────────────────────────────────────────────────────────────────────────────
// HORIZONTAL JOURNEY · Project detail — one stop on the walk.
//
// Azure sky hero: avenue + date as the eyebrow, the title, venue and year, and
// the lead photograph propped on the hills like a postcard (it opens the
// viewer). Then the stop itself on cream: the club's write-up, the figures as
// the sample's shape figures, the photographs as tilted prints with their
// captions, and a share rail. Updates (child projects) close the page on a dusk
// band: a trail of dated suns with a card each, every card opening that update
// in a dialog, exactly the content Gold's popup shows. On wide + tall screens
// with motion and 4–12 updates the band pins and the trail runs sideways (cards
// lean with scroll speed, as on the home journey); everywhere else the trail
// runs down the page.
//
// Data: useProjectData (= goldData.useProjectGold -> loadProject: child
// recovery, captions index-aligned with photos). Share: useProjectShare +
// shareChannels. ?pid=0/unknown -> designed not-found; ?pr=CE -> back goes to
// /projects?pr=CE.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectData, useProjectShare, shareChannels, sharePopup, SHARE_ICONS,
  PhotoLightbox, LightboxStyles, avenueLabel, formatMoney, groupInt,
} from '../../_shared/data.js'
import { PageHero, SectionHead, Band, Button, PhotoCard, StatRow, EmptyState, Loading, NotFound, Ridge, SafeImg, IconArrow, yearText, useLightboxModal } from '../kit.jsx'
import {
  gsap, useScene, afterFonts, useRefreshOnImages, useMedia, lockScroll, MOTION_OK,
  titleIn, rise, revealBatch, wipeIn, fanIn, parallax, pinTrack,
} from '../motion.js'
import './ProjectDetail.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DRIFT = [1, -0.6, 0.8, -1, 0.5, -0.8, 0.9]

/** Day / month / year for an update's sun, or null when it carries no date. */
function splitDate(raw) {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return { day: String(d.getDate()).padStart(2, '0'), mon: MON[d.getMonth()], year: d.getFullYear() }
}

/** "Jul 2026 – Aug 2026", or one month when every update falls in it (Gold's runSpan). */
function runSpan(list) {
  const ds = list.map((c) => (c.date ? new Date(c.date) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b)
  if (!ds.length) return ''
  const label = (d) => MON[d.getMonth()] + ' ' + d.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

/** Admin HTML may carry its own <h1>; the hero owns the page's only one. */
const demoteH1 = (html) => (html ? String(html).replace(/<(\/?)h1\b/gi, '<$1h2') : '')

const svg = (d, extra) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}{extra}</svg>
)
const I = {
  cal: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  pin: svg(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>),
  sun: svg(<><circle cx="12" cy="14" r="4" /><path d="M12 5v2M5.6 7.6 7 9M18.4 7.6 17 9M3 18h18" /></>),
  zoom: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5M11 8v6M8 11h6" /></>),
  x: svg(<path d="M18 6 6 18M6 6l12 12" />),
}

/** One update's full record — the dialog body (Gold's UpdateBody content). */
function UpdateBody({ c, cur, onPhoto }) {
  const figs = [
    c.costText && { n: c.costText, l: 'Project cost', s: 'pill', t: 'var(--hj-gold)' },
    c.beneficiaries > 0 && { n: groupInt(c.beneficiaries, cur), l: 'Beneficiaries', s: 'circle', t: 'var(--hj-royal)' },
    c.rotarians > 0 && { n: groupInt(c.rotarians, cur), l: 'Rotarians', s: 'arch', t: 'var(--hj-cran)' },
    c.manHours > 0 && { n: groupInt(c.manHours, cur), l: 'Man hours', s: 'square', t: 'var(--hj-azure)' },
  ].filter(Boolean)
  const html = demoteH1(c.descriptionHtml)
  return (
    <>
      <p className="hj-pd-dlg__k">Project update</p>
      <h2 className="hj-pd-dlg__t" id="hj-pd-dlg-t">{c.title || 'Project update'}</h2>
      {(c.dateText || c.location) ? (
        <ul className="hj-pd-meta hj-pd-dlg__meta">
          {c.dateText ? <li>{I.cal}<span>{c.dateText}</span></li> : null}
          {c.location ? <li>{I.pin}<span>{c.location}</span></li> : null}
        </ul>
      ) : null}
      {c.photos.length > 0 && (
        <ul className="hj-pd-dlg__ph">
          {c.photos.map((ph, i) => (
            <li key={i}>
              <button type="button" onClick={() => onPhoto(c.photos, i, c.captions)}
                      aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length + (c.captions && c.captions[i] ? ': ' + c.captions[i] : '')}>
                <SafeImg src={ph} alt="" width="400" height="300" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {figs.length > 0 && (
        <ul className="hj-pd-figs">
          {figs.map((f) => (
            <li className="hj-pd-fig" key={f.l}>
              <span className="hj-pd-fig__s" data-shape={f.s} style={{ background: f.t }} aria-hidden="true" />
              <span><span className="hj-pd-fig__n">{f.n}</span><span className="hj-pd-fig__l">{f.l}</span></span>
            </li>
          ))}
        </ul>
      )}
      {html ? (
        <div className="hj-pd-dlg__ov">
          <p className="hj-pd-dlg__k">Overview</p>
          <div className="hj-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : null}
    </>
  )
}

export default function ProjectDetail({ data }) {
  const club = useClub()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const pid = parseInt(params.get('pid'), 10) || 0
  const fromMeetings = params.get('pr') === 'CE'
  const backHref = fromMeetings ? '/projects?pr=CE' : '/projects'
  const backLabel = fromMeetings ? 'Back to Club Services' : 'Back to all projects'
  const listLabel = fromMeetings ? 'Club Services' : 'Projects'
  const cur = club.currency
  const yr = yearText(club.selectedYearLabel)

  // The local ?demoChild=1 preview needs isLocalRequest, which data.js does not export.
  const { p, notFound } = useProjectData(pid, false, data)

  // The API's own share payload; p.shareFallback keeps the row working without it.
  const share = useProjectShare({ projectId: p ? p.id : 0, yearId: p ? p.yearId : null, fallback: p ? p.shareFallback : null })
  const channels = shareChannels(share)

  const [lb, setLb] = useState(null)               // { urls, caps, idx }
  const [openChild, setOpenChild] = useState(null)
  const [badShot, setBadShot] = useState('')      // the lead photo URL that failed to load
  const ref = useRef(null)
  const dlgRef = useRef(null)
  const lbFrom = useRef(null)
  const childFrom = useRef(null)

  const wide = useMedia('(min-width: 900px)')
  const tall = useMedia('(min-height: 700px)')
  const motionOk = useMedia(MOTION_OK)

  const photos = p ? p.photos : []
  const captions = p ? (p.photoCaptions || []) : []
  const kids = p ? p.children : []
  // ponytail: sideways only for 4–12 updates; a 48-update project reads better as a list.
  const horiz = wide && tall && motionOk && kids.length >= 4 && kids.length <= 12

  useEffect(() => { setLb(null); setOpenChild(null) }, [pid])

  // `caps` travel WITH the urls: an update's photos have their own captions.
  const openLb = (urls, start, caps) => {
    if (!urls || !urls.length) return
    lbFrom.current = document.activeElement
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }

  // The dialog owns Esc only while the viewer is closed (the viewer sits above it) — as Gold.
  useEffect(() => {
    if (!openChild || lb) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenChild(null) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      if (!lb) document.body.style.overflow = ''
    }
  }, [openChild, lb])

  // Smooth scroll holds still under either overlay.
  const layered = !!(lb || openChild)
  useEffect(() => {
    if (!layered) return undefined
    lockScroll(true)
    return () => lockScroll(false)
  }, [layered])

  // Focus into the dialog, and back to the card that opened it.
  useEffect(() => {
    if (!openChild) return undefined
    const x = dlgRef.current && dlgRef.current.querySelector('.hj-pd-dlg__x')
    if (x) x.focus()
    return () => { const t = childFrom.current; if (t && t.isConnected) t.focus({ preventScroll: true }) }
  }, [openChild])

  // The shared viewer as a modal (page and dialog inert, focus in and back); smooth scroll is held above.
  useLightboxModal(!!lb, lbFrom, { lock: false })

  const trap = (e) => {
    if (e.key !== 'Tab' || !dlgRef.current) return
    const f = [...dlgRef.current.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.getClientRects().length > 0)
    if (!f.length) return
    const first = f[0], last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const sig = p ? [p.id, photos.length, kids.length].join('|') : ''
  useRefreshOnImages(ref, [sig])

  useScene(ref, (c, ctx) => afterFonts(ctx, () => {
    const r = ref.current
    if (!r) return
    // chapter heads: the title rises out of the skew, kicker + sub follow
    r.querySelectorAll('.hj-pd-sec .hj-sh').forEach((sh) => {
      titleIn(sh.querySelector('.hj-h2'))
      rise(sh.querySelectorAll('.hj-kicker, .hj-sh__sub'), sh, { from: { y: 28 }, stagger: 0.06 })
    })
    const shot = r.querySelector('.hj-pd-shot__frame')
    if (shot) wipeIn(shot, { start: 'top 98%' })
    const prose = r.querySelector('.hj-pd-prose')
    if (prose && prose.children.length) revealBatch(prose.children, { y: 28, stagger: 0.05 })
    const prints = r.querySelectorAll('.hj-pd-ph')
    if (prints.length) fanIn(prints, { start: 'top 92%' })
    rise(r.querySelector('.hj-pd-rail'), null, { from: { x: 40, y: 0 } })

    // updates: a trail across the band (pinned, wide) or down it
    const run = r.querySelector('.hj-pd-run')
    if (!run) return
    const track = run.querySelector('.hj-pd-run__track')
    const items = [...run.querySelectorAll('.hj-pd-run__it')]
    const num = run.querySelector(':scope > .hj-band__num')
    if (horiz && c.wide && track.offsetWidth > run.clientWidth + 40) {
      // velocity: the cards lean into the travel and settle when it stops
      const leanTo = gsap.quickTo(items, 'skewX', { duration: 0.6, ease: 'power3' })
      const settle = gsap.delayedCall(0.14, () => leanTo(0)).pause()
      const pt = pinTrack(run, track, {
        onUpdate: (self) => { leanTo(gsap.utils.clamp(-7, 7, self.getVelocity() / 380)); settle.restart(true) },
      })
      if (!pt) return
      const D = pt.tl.duration()
      if (num) pt.tl.fromTo(num, { xPercent: 0 }, { xPercent: -35, duration: D }, 0)
      items.forEach((it, i) => {
        const ca = (start, end) => ({ trigger: it, containerAnimation: pt.tl, start, end, scrub: true })
        const card = it.querySelector('.hj-card')
        const dy = DRIFT[i % DRIFT.length] * 22
        if (card) gsap.fromTo(card, { y: dy }, { y: -dy, ease: 'none', scrollTrigger: ca('left right', 'right left') })
        const m = it.querySelector('.hj-card__m')
        if (m) gsap.fromTo(m, { clipPath: 'inset(0% 0% 0% 100%)' }, { clipPath: 'inset(0% 0% 0% 0%)', ease: 'power2.out', scrollTrigger: ca('left 105%', 'left 62%') })
        const sun = it.querySelector('.hj-pd-run__sun')
        if (sun) gsap.fromTo(sun, { scale: 0.3, yPercent: 60, opacity: 0 }, { scale: 1, yPercent: 0, opacity: 1, ease: 'back.out(1.6)', scrollTrigger: ca('left 100%', 'left 70%') })
      })
    } else {
      revealBatch(items, { y: 40, stagger: 0.08 })
      items.forEach((it) => {
        const m = it.querySelector('.hj-card__m')
        if (m) wipeIn(m, { trigger: it })
      })
      if (num) parallax(num, { trigger: run })
    }
  }), [sig, horiz])

  // ── states ──────────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="hj-page hj-pd">
        <NotFound title="Project not found" message="We couldn’t find the project you were looking for."
                  crumbs={[{ label: listLabel, href: backHref }]} backHref={backHref} backLabel={backLabel} />
      </div>
    )
  }
  // Nothing claims "not found" before the fetch resolves.
  if (!p) return <div className="hj-page hj-pd-wait"><Loading label="Loading the project" /></div>

  const desc = demoteH1(p.description)
  const long = p.cost > 0 && formatMoney(p.cost, p.currency).length > 11
  const figs = [
    p.cost !== null && p.cost > 0 && { value: p.cost, label: 'Total cost', shape: 'pill', tone: 'gold', fmt: (n) => formatMoney(n, p.currency, long ? { compact: true } : undefined) },
    p.beneficiaries > 0 && { value: p.beneficiaries, label: 'Beneficiaries', shape: 'circle', tone: 'royal' },
    p.rotarians > 0 && { value: p.rotarians, label: 'Rotarians involved', shape: 'arch', tone: 'cran' },
    p.manHours > 0 && { value: p.manHours, label: 'Man hours', shape: 'square', tone: 'azure' },
  ].filter(Boolean)

  const chapters = [desc && 'ov', figs.length > 0 && 'num', photos.length > 1 && 'ph', kids.length > 0 && 'run'].filter(Boolean)
  const num = (k) => String(chapters.indexOf(k) + 1).padStart(2, '0')
  const bare = !desc && !figs.length && photos.length < 2
  const span = runSpan(kids)
  const hasShot = photos.length > 0 && badShot !== photos[0]

  const meta = [
    p.location && <li key="pin">{I.pin}<span>{p.location}</span></li>,
    yr && <li key="yr">{I.sun}<span>Rotary year {yr}</span></li>,
  ].filter(Boolean)

  const shot = hasShot ? (
    <div className="hj-pd-shot">
      <button type="button" className="hj-pd-shot__frame" onClick={() => openLb(photos, 0, captions)}
              aria-label={photos.length > 1 ? 'View all ' + photos.length + ' photos' : 'View the photo full size'}>
        <img src={photos[0]} alt="" width="800" height="600" decoding="async" onError={() => setBadShot(photos[0])} />
        <span className="hj-pd-shot__tag" aria-hidden="true">{I.zoom}{photos.length > 1 ? photos.length + ' photos' : 'Full size'}</span>
      </button>
    </div>
  ) : null

  return (
    <div className="hj-page hj-ground--cream hj-pd" ref={ref}>
      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
                     onIndex={(i) => setLb((l) => (i === null || !l ? null : { ...l, idx: i }))} />

      <PageHero tone="azure" menuTitle={false} title={p.title || 'Project'} crumbs={[{ label: listLabel, href: backHref }]}>
        {meta.length ? <ul className="hj-pd-meta">{meta}</ul> : null}
      </PageHero>

      {/* the stop itself; with updates it closes on ridges in the band's dusk colour */}
      <div className={'hj-pd-stop' + (kids.length ? ' has-ridge' : '')} style={kids.length ? { '--hj-next': 'var(--hj-royal)' } : undefined}>
      <div className={'hj-wrap hj-sec hj-pd-body' + (kids.length ? '' : ' hj-endpad')}>
        <div className="hj-pd-main">
          {/* the lead photo opens the stop, not the band (client: no image in the page head) */}
          {shot}
          {desc ? (
            <section className="hj-pd-sec" aria-labelledby="hj-pd-ov-t">
              <SectionHead k={num('ov')} title="Overview" id="hj-pd-ov-t" />
              {/* Trusted admin rich HTML, rendered as Gold does. */}
              <div className="hj-prose hj-pd-prose" dangerouslySetInnerHTML={{ __html: desc }} />
            </section>
          ) : null}

          {figs.length > 0 && (
            <section className="hj-pd-sec" aria-labelledby="hj-pd-num-t">
              <SectionHead k={num('num')} title="By the numbers" id="hj-pd-num-t" />
              <StatRow items={figs} currency={cur} className="hj-pd-stats" />
            </section>
          )}

          {photos.length > 1 && (
            <section className="hj-pd-sec" aria-labelledby="hj-pd-ph-t">
              <SectionHead k={num('ph')} title="Photographs" id="hj-pd-ph-t" sub={photos.length + ' photos · open any to see it full size'} />
              <ul className="hj-pd-gal">
                {photos.map((url, i) => (
                  <li className="hj-pd-ph" key={i}>
                    <button type="button" className="hj-pd-ph__b" onClick={() => openLb(photos, i, captions)}
                            aria-label={'View photo ' + (i + 1) + ' of ' + photos.length + (captions[i] ? ': ' + captions[i] : '')}>
                      <span className="hj-pd-ph__m"><SafeImg src={url} alt="" width="480" height="360" /></span>
                      {captions[i] ? <span className="hj-pd-ph__c">{captions[i]}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>

        <div className="hj-pd-rail">
          <h2 className="hj-pd-rail__t">Share this project</h2>
          <ul className="hj-pd-share">
            {channels.map((ch) => {
              const glyph = (
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"
                     fill={ch.fill ? 'currentColor' : 'none'} stroke={ch.fill ? 'none' : 'currentColor'}
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {ch.done ? SHARE_ICONS.check : ch.icon}
                </svg>
              )
              const style = ch.brand ? { '--hj-brand': ch.brand } : undefined
              const newTab = ch.key !== 'mail'
              return (
                <li key={ch.key}>
                  {ch.href ? (
                    <a className="hj-pd-share__b" href={ch.href} style={style} title={ch.label}
                       aria-label={ch.label + (newTab ? ' (opens in a new tab)' : '')}
                       target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}
                       onClick={ch.popup ? sharePopup : undefined}>{glyph}</a>
                  ) : (
                    <button type="button" className="hj-pd-share__b" style={style} title={ch.label} aria-label={ch.label} onClick={ch.onClick}>
                      {glyph}
                      {ch.doneLabel ? <span className={'hj-pd-share__toast' + (ch.done ? ' is-on' : '')} aria-live="polite">{ch.done ? ch.doneLabel : ''}</span> : null}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <Button href={backHref} variant="ink" size="sm" icon="back">{backLabel}</Button>
        </div>
      </div>
      {kids.length > 0 && (
        <div className="hj-pd-stop__ridge" aria-hidden="true">
          <Ridge preset="pnFar" fill="color-mix(in srgb, var(--hj-next) 38%, transparent)" />
          <Ridge preset="pnFront" className="hj-rg--front" />
        </div>
      )}
      </div>

      {kids.length > 0 && (
        <Band tone="royal" next="var(--hj-night)" num={String(kids.length)} labelledBy="hj-pd-run-t"
              className={'hj-pd-sec hj-pd-run hj-endpad' + (horiz ? ' is-h' : '')}>
          <SectionHead k={num('run')} title="Project updates" id="hj-pd-run-t"
                       sub={kids.length + ' update' + (kids.length === 1 ? '' : 's') + (span ? ' · ' + span : '')} />
          <div className="hj-pd-run__track">
            <div className="hj-pd-run__line" aria-hidden="true">
              <Ridge preset="pnFar" fill="rgba(255,255,255,.1)" rim="rgba(255,255,255,.34)" />
            </div>
            <ol className="hj-pd-run__list">
              {kids.map((c, i) => {
                const d = splitDate(c.date)
                return (
                  <li className="hj-pd-run__it" key={(c.id || 'u') + '-' + i}>
                    <p className="hj-pd-run__d">
                      <span className="hj-pd-run__sun" aria-hidden="true">{d ? d.day : '–'}</span>
                      <span className="hj-pd-run__when">{d ? d.day + ' ' + d.mon + ' ' + d.year : 'Undated'}</span>
                    </p>
                    <PhotoCard img={c.photos[0]} meta={c.location || undefined} imgProps={{ width: 400, height: 300 }}
                               desc={c.beneficiaries > 0 ? groupInt(c.beneficiaries, cur) + ' beneficiaries' : undefined}
                               title={(
                                 <button type="button" className="hj-pd-run__open" aria-haspopup="dialog"
                                         onClick={(e) => { childFrom.current = e.currentTarget; setOpenChild(c) }}>
                                   <span className="hj-pd-run__tt">{c.title || 'Project update'}</span>
                                 </button>
                               )}>
                      <span className="hj-pd-run__more" aria-hidden="true">Open update<IconArrow /></span>
                    </PhotoCard>
                  </li>
                )
              })}
            </ol>
          </div>
        </Band>
      )}

      {openChild && createPortal(
        <div className="hj-pd-dlg" ref={dlgRef} role="dialog" aria-modal="true" aria-labelledby="hj-pd-dlg-t"
             onKeyDown={trap} data-lenis-prevent="">
          <div className="hj-pd-dlg__bg" onClick={() => setOpenChild(null)} />
          <div className="hj-pd-dlg__panel">
            <div className="hj-pd-dlg__sky" aria-hidden="true">
              <span className="hj-pd-dlg__sun" />
              <Ridge preset="far" />
              <Ridge preset="ground" fill="#fff" rim={null} className="hj-rg--ground" />
            </div>
            <button type="button" className="hj-pd-dlg__x" aria-label="Close" onClick={() => setOpenChild(null)}>{I.x}</button>
            <div className="hj-pd-dlg__body">
              <UpdateBody c={openChild} cur={cur} onPhoto={openLb} />
            </div>
          </div>
        </div>, document.body)}
    </div>
  )
}
