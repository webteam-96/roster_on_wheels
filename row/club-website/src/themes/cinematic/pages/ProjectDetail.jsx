'use client'
// ─────────────────────────────────────────────────────────────────────────────
// CINEMATIC · PROJECT DETAIL — "the feature".
// The hero projects a blurred copy of the project's photo behind its title
// (avenue as the eyebrow, the date as a slate). Then the photograph itself on a
// lit 16:9 screen that opens like a projector, the picture drifting inside it;
// the figures in condensed gold counting up; the club's own write-up; a contact
// sheet of the remaining frames that wipe open from the bottom (PhotoLightbox,
// captions travel with the set); the updates as a timeline drawn in gold, each
// opening its own panel exactly as Gold's popup does; and the share credits.
//
// Data + rules: useProjectData (goldData.useProjectGold -> loadProject) and
// useProjectShare/shareChannels, used as ProjectDetailGold uses them.
// ?pr=CE sends "back" to /projects?pr=CE; ?pid=0/unknown -> NotFound.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectData, usePageTitle, avenueLabel, formatMoney, groupInt,
  useProjectShare, shareChannels, sharePopup, SHARE_ICONS, PhotoLightbox, LightboxStyles,
} from '../../_shared/data.js'
import {
  PageHero, SectionHead, StatRow, Button, NotFound, Loading, DateStamp, Arrow, ArrowBack, Pin, hideOnError, demoteH1, useModal,
} from '../kit.jsx'
import { gsap, useScene, useRefreshOnImages, riseIn, wipeIn, parallax, projectorOpen, prefersReducedMotion, rowsOf } from '../motion.js'
import './ProjectDetail.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 2026 – Aug 2026", or one month when every update falls in it (Gold's runSpan). */
function runSpan(list) {
  const ds = list.map((c) => (c.date ? new Date(c.date) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b)
  if (ds.length === 0) return ''
  const label = (d) => MON[d.getMonth()] + ' ' + d.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

/** "dd MMM yyyy" (fmtDate) -> DateStamp parts. */
const stampOf = (text) => {
  const [day, mon, year] = String(text || '').split(' ')
  return { day, mon, year }
}

const Ico = ({ children }) => (
  <svg className="cin-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
)
const ZoomIco = () => <Ico><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></Ico>
const CloseIco = () => <Ico><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></Ico>

// ── the lit screen: the main photograph ──────────────────────────────────────
function Screen({ src, alt, count, onOpen }) {
  const ref = useRef(null)
  useScene(ref, () => {
    projectorOpen(ref.current.querySelector('.cin-pd-screen'), { duration: 1.3, delay: 0.3 })
    parallax(ref.current.querySelector('.cin-pd-screen__img'), { amount: 4 })
  }, [src])
  return (
    <div ref={ref} className="cin-pd-stage">
      <figure className="cin-pd-screen">
        <span className="cin-pd-screen__fill" aria-hidden="true"><img src={src} alt="" onError={hideOnError} /></span>
        <img className="cin-pd-screen__img" src={src} alt={alt} width="1600" height="900" decoding="async" onError={hideOnError} />
        <button type="button" className="cin-pd-screen__zoom" onClick={onOpen}>
          <ZoomIco />{count > 1 ? 'View all ' + count + ' photos' : 'View full size'}
        </button>
      </figure>
    </div>
  )
}

// ── figures + the club's write-up ────────────────────────────────────────────
function Story({ figs, html }) {
  const ref = useRef(null)
  useScene(ref, () => {
    const prose = ref.current.querySelector('.cin-pd-over')
    if (prose) riseIn(prose.children, { stagger: 0.08 })
  }, [html])
  return (
    <div ref={ref} className="cin-pd-story">
      {figs.length ? (
        <section className="cin-sec cin-pd-nums" aria-labelledby="cin-pd-nums-h">
          <h2 className="cin-pd-cap" id="cin-pd-nums-h">By the numbers</h2>
          <StatRow items={figs} />
        </section>
      ) : null}
      {html ? (
        <section className="cin-sec cin-pd-over" aria-labelledby="cin-pd-over-h">
          <h2 className="cin-pd-cap" id="cin-pd-over-h">Overview</h2>
          {/* Trusted admin rich HTML (wrappableHtml), rendered verbatim like Gold. */}
          <div className="cin-prose cin-pd-prose" dangerouslySetInnerHTML={{ __html: html }} />
        </section>
      ) : null}
    </div>
  )
}

// ── the contact sheet ────────────────────────────────────────────────────────
function Sheet({ photos, captions, onOpen }) {
  const ref = useRef(null)
  const sig = photos.join('|')
  useScene(ref, () => {
    rowsOf([...ref.current.querySelectorAll('.cin-pd-shot')]).forEach((row) => wipeIn(row, { trigger: row[0], radius: 18 }))
  }, [sig])
  useRefreshOnImages(ref, [sig])
  return (
    <section ref={ref} className="cin-sec cin-pd-photos" aria-labelledby="cin-pd-photos-h">
      <SectionHead id="cin-pd-photos-h" title="Photographs" lede={photos.length + ' photos. Select one to view it full size.'} />
      <ul className="cin-pd-sheet">
        {photos.map((url, i) => (
          <li key={i} className="cin-pd-shot">
            <button type="button" className="cin-pd-shot__btn" onClick={(e) => onOpen(i, e)}
              aria-label={'View photo ' + (i + 1) + ' of ' + photos.length}
              aria-describedby={captions[i] ? 'cin-pd-cap-' + i : undefined}>
              <img src={url} alt="" loading="lazy" decoding="async" width="800" height="600" onError={hideOnError} />
              <span className="cin-pd-shot__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <span className="cin-pd-shot__z" aria-hidden="true"><ZoomIco /></span>
            </button>
            {captions[i] ? <p className="cin-pd-shot__cap" id={'cin-pd-cap-' + i}>{captions[i]}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── the updates: a timeline drawn in gold ────────────────────────────────────
function Updates({ list, currency, onOpen }) {
  const ref = useRef(null)
  const sig = list.map((c) => c.id).join(',')
  useScene(ref, () => {
    const root = ref.current
    gsap.fromTo(root.querySelector('.cin-pd-runs__rule'), { scaleY: 0 }, {
      scaleY: 1, ease: 'none', scrollTrigger: { trigger: root.querySelector('.cin-pd-runs'), start: 'top 75%', end: 'bottom 65%', scrub: true },
    })
    root.querySelectorAll('.cin-pd-run').forEach((li) => riseIn(li, { x: 60, y: 0, start: 'top 90%' }))
  }, [sig])
  useRefreshOnImages(ref, [sig])
  const span = runSpan(list)
  return (
    <section ref={ref} className="cin-sec cin-pd-updates" aria-labelledby="cin-pd-upd-h">
      <SectionHead id="cin-pd-upd-h" title="Project updates"
        lede={list.length + ' update' + (list.length === 1 ? '' : 's') + (span ? ' · ' + span : '')} />
      <div className="cin-pd-runs-wrap">
        <span className="cin-pd-runs__rule" aria-hidden="true" />
        <ol className="cin-pd-runs">
          {list.map((c) => {
            const d = stampOf(c.dateText)
            return (
              <li key={c.id} className="cin-pd-run">
                <button type="button" className="cin-pd-run__btn" aria-haspopup="dialog" onClick={(e) => onOpen(c, e)}>
                  <span className="cin-pd-run__when">
                    {d.day ? <DateStamp day={d.day} mon={d.mon} year={d.year} /> : <span className="cin-pd-run__nodate">Undated</span>}
                  </span>
                  <span className="cin-pd-run__body">
                    <span className="cin-pd-run__t">{c.title}</span>
                    {c.location || c.beneficiaries > 0 ? (
                      <span className="cin-pd-run__m">
                        {c.location ? <span>{c.location}</span> : null}
                        {c.beneficiaries > 0 ? <span>{groupInt(c.beneficiaries, currency)} beneficiaries</span> : null}
                      </span>
                    ) : null}
                  </span>
                  <span className="cin-pd-run__pic" aria-hidden="true">
                    {c.photos.length ? <img src={c.photos[0]} alt="" loading="lazy" decoding="async" width="160" height="120" onError={hideOnError} /> : null}
                  </span>
                  <span className="cin-pd-run__go" aria-hidden="true"><Arrow /></span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

// ── one update, in its own panel (Gold's popup: photos, figures, write-up) ───
function UpdatePanel({ c, currency, onClose, onPhoto }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()
  useLayoutEffect(() => {
    if (closeRef.current) closeRef.current.focus({ preventScroll: true })
    if (prefersReducedMotion()) return undefined
    const t = projectorOpen(panelRef.current, { duration: 0.8 })
    return () => { if (t) t.kill() }
  }, [c])
  const figs = [
    c.costText && ['Project cost', c.costText],
    c.beneficiaries > 0 && ['Beneficiaries', groupInt(c.beneficiaries, currency)],
    c.rotarians > 0 && ['Rotarians', groupInt(c.rotarians, currency)],
    c.manHours > 0 && ['Man hours', groupInt(c.manHours, currency)],
  ].filter(Boolean)
  const html = demoteH1(c.descriptionHtml).trim()

  return createPortal(
    <div className="cin-pd-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="cin-pd-modal__bg" onClick={onClose} aria-hidden="true" />
      <div className="cin-pd-modal__panel" ref={panelRef}>
        <button type="button" className="cin-pd-modal__x" ref={closeRef} onClick={onClose}>
          <span className="cin-sr">Close update</span><CloseIco />
        </button>
        <div className="cin-pd-modal__scroll" data-lenis-prevent="">
          <p className="cin-pd-cap">Project update</p>
          <h2 className="cin-pd-modal__t" id={titleId}>{c.title}</h2>
          {c.dateText || c.location ? (
            <p className="cin-pd-modal__meta">
              {c.dateText ? <span className="cin-pd-modal__date">{c.dateText}</span> : null}
              {c.location ? <span><Pin />{c.location}</span> : null}
            </p>
          ) : null}
          {c.photos.length ? (
            <ul className="cin-pd-modal__pics">
              {c.photos.map((ph, i) => (
                <li key={i}>
                  <button type="button" onClick={(e) => onPhoto(c.photos, i, c.captions, e)}
                    aria-label={'View photo ' + (i + 1) + ' of ' + c.photos.length}>
                    <img src={ph} alt="" loading="lazy" decoding="async" width="400" height="300" onError={hideOnError} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {figs.length ? (
            <dl className="cin-stats cin-pd-modal__figs">
              {figs.map(([l, n]) => (
                <div className="cin-stat" key={l}><dt className="cin-stat__l">{l}</dt><dd className="cin-stat__v">{n}</dd></div>
              ))}
            </dl>
          ) : null}
          {html ? <div className="cin-prose cin-pd-modal__prose" dangerouslySetInnerHTML={{ __html: html }} /> : null}
        </div>
      </div>
    </div>, document.body)
}

// ── the credits: share + the way back ────────────────────────────────────────
function Credits({ channels, backHref, backLabel }) {
  const ref = useRef(null)
  useScene(ref, () => { riseIn(ref.current.querySelectorAll('.cin-pd-end__col'), { stagger: 0.1 }) }, [channels.length])
  return (
    <section ref={ref} className="cin-sec cin-pd-end" aria-labelledby="cin-pd-share-h">
      <div className="cin-pd-end__col">
        <h2 className="cin-pd-cap" id="cin-pd-share-h">Share this project</h2>
        <ul className="cin-pd-share">
          {channels.map((ch) => {
            const glyph = (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"
                fill={ch.fill && !ch.done ? 'currentColor' : 'none'} stroke={ch.fill && !ch.done ? 'none' : 'currentColor'}
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ch.done ? SHARE_ICONS.check : ch.icon}
              </svg>
            )
            const newTab = ch.href && ch.key !== 'mail'
            return (
              <li key={ch.key}>
                {ch.href ? (
                  <a href={ch.href} className="cin-magnet" aria-label={ch.label + (newTab ? ' (opens in a new tab)' : '')}
                    title={ch.label} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}
                    onClick={ch.popup ? sharePopup : undefined}>{glyph}</a>
                ) : (
                  <button type="button" className="cin-magnet" aria-label={ch.label} title={ch.label} onClick={ch.onClick}>{glyph}</button>
                )}
                {ch.doneLabel ? <span className={'cin-pd-share__toast' + (ch.done ? ' is-on' : '')} aria-live="polite">{ch.done ? ch.doneLabel : ''}</span> : null}
              </li>
            )
          })}
        </ul>
      </div>
      <div className="cin-pd-end__col">
        <Button href={backHref} variant="line"><ArrowBack /> {backLabel}</Button>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ProjectDetail({ data }) {
  const club = useClub()
  const loc = useLocation()
  const params = new URLSearchParams(loc.search)
  const pid = parseInt(params.get('pid'), 10) || 0
  const fromMeetings = params.get('pr') === 'CE'
  const listLabel = fromMeetings ? 'Club Services' : 'Projects'
  const backHref = fromMeetings ? '/projects?pr=CE' : '/projects'
  const backLabel = fromMeetings ? 'Back to Club Services' : 'Back to all projects'

  // demoChild (local ?demoChild=1 preview) needs isLocalRequest, which data.js does not export.
  const { p, notFound } = useProjectData(pid, false, data)
  usePageTitle(p ? p.title : null)   // NotFound sets its own title

  const share = useProjectShare({
    projectId: p ? p.id : 0,
    yearId: p ? p.yearId : null,
    fallback: p ? p.shareFallback : null,
  })
  const channels = shareChannels(share).filter((ch) => ch.href || ch.onClick)

  const [lb, setLb] = useState(null)             // { urls, caps, idx }
  const [openChild, setOpenChild] = useState(null)
  const lbBack = useRef(null)
  const childBack = useRef(null)
  const pageRef = useRef(null)
  const lbOpen = !!lb
  const childOpen = !!openChild

  // `caps` travel WITH the urls: an update's photos must not borrow the main set's captions.
  const openLb = (urls, start, caps, e) => {
    if (!urls || urls.length === 0) return
    lbBack.current = e ? e.currentTarget : null
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }
  const openUpdate = (c, e) => { childBack.current = e.currentTarget; setOpenChild(c) }

  // Both are dialogs: the site behind inert and still (Lenis too), focus in and
  // back to the opener. The viewer can open from inside the panel and stacks on
  // it; the panel focuses its own close button.
  useModal(lbOpen, lbBack)
  useModal(childOpen, childBack, null)

  // The update panel owns Esc only while the viewer (which sits above it) is closed.
  useEffect(() => {
    if (!childOpen || lbOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenChild(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [childOpen, lbOpen])

  useRefreshOnImages(pageRef, [p])

  if (notFound) {
    return (
      <NotFound title="Project not found"
        message="We couldn’t find the project you were looking for. It may have been moved, or it is no longer published."
        backHref={backHref} backLabel={backLabel}
        crumbs={[{ label: listLabel, href: backHref }, { label: 'Project not found' }]} />
    )
  }
  // Nothing claims "not found" before the fetch resolves.
  if (!p) return <Loading label="Loading the project" />

  const cur = club.currency
  const photos = p.photos || []
  const captions = p.photoCaptions || []
  const kids = p.children || []
  const html = demoteH1(p.description).trim()
  const figs = [
    p.cost !== null && p.cost > 0 && { label: 'Total cost', value: p.cost, format: (n) => formatMoney(n, p.currency) },
    p.beneficiaries > 0 && { label: 'Beneficiaries', value: p.beneficiaries, format: (n) => groupInt(n, cur) },
    p.rotarians > 0 && { label: 'Rotarians involved', value: p.rotarians, format: (n) => groupInt(n, cur) },
    p.manHours > 0 && { label: 'Man hours', value: p.manHours, format: (n) => groupInt(n, cur) },
  ].filter(Boolean)
  const when = stampOf(p.dateText)
  const facts = when.day || p.location ? (
    <div className="cin-pd-facts">
      {when.day ? <DateStamp day={when.day} mon={when.mon} year={when.year} /> : null}
      {p.location ? <p className="cin-pd-fact"><Pin /><span><span className="cin-sr">Venue: </span>{p.location}</span></p> : null}
    </div>
  ) : null

  return (
    <div className="cin-pd" ref={pageRef}>
      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
        onIndex={(i) => setLb((l) => (i === null || !l ? null : { ...l, idx: i }))} />

      <PageHero
        title={p.title}
        eyebrow={avenueLabel(p.moduleKey) || undefined}
        crumbs={[{ label: listLabel, href: backHref }, { label: p.title }]}
        backdrop={photos[0] || undefined}
        meta={facts}
      />

      {photos.length ? (
        <Screen src={photos[0]} alt={captions[0] || p.title} count={photos.length}
          onOpen={(e) => openLb(photos, 0, captions, e)} />
      ) : null}

      {figs.length || html ? <Story figs={figs} html={html} /> : null}

      {photos.length > 1 ? (
        <Sheet photos={photos} captions={captions} onOpen={(i, e) => openLb(photos, i, captions, e)} />
      ) : null}

      {kids.length ? <Updates list={kids} currency={cur} onOpen={openUpdate} /> : null}

      <Credits channels={channels} backHref={backHref} backLabel={backLabel} />

      {openChild ? (
        <UpdatePanel c={openChild} currency={cur} onClose={() => setOpenChild(null)} onPhoto={openLb} />
      ) : null}
    </div>
  )
}
