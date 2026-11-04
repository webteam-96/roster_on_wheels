'use client'
// ─────────────────────────────────────────────────────────────────────────────
// SUNRISE · PROJECT DETAIL — the project seen through the window.
//
// The page head (crumbs, the title arriving from depth), its facts (avenue,
// date / place / year) and then the home's window: the project's photographs
// shown whole (no blurred copy behind them, client 2026-10-06), rising into place like the
// sun, with dots + pause and the caption of the picture on show. Selecting it
// opens the shared PhotoLightbox.
// Then the club's own write-up (paragraphs focus as they reach the reading line)
// beside the figures, which count up; a contact sheet of every photo with its
// caption, lifting off a tilted plane; the updates as a dated list whose sun
// discs rise as they arrive, each opening its own panel exactly as Gold's popup
// does; and the share row with the way back.
//
// Data + rules: useProjectData (goldData.useProjectGold -> loadProject, which
// already recovers child updates the API leaves out) and useProjectShare /
// shareChannels, used as ProjectDetailGold uses them. ?pr=CE sends "back" to
// /projects?pr=CE; ?pid=0 / unknown -> NotFound.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from '@/site/router.js'
import {
  useClub, useProjectData, avenueLabel, groupInt, plainText,
  useProjectShare, shareChannels, sharePopup, SHARE_ICONS, PhotoLightbox, LightboxStyles,
} from '../../_shared/data.js'
import {
  PageHero, SectionHead, StatRow, Button, Panel, NotFound, Loading, DateSun, WinSlide, SlideCtrl, useSlides,
  noEmoji, demoteH1, Arrow, SearchIcon, CloseIcon, PinIcon, CalendarIcon, hideOnError, yearText,
} from '../kit.jsx'
import {
  gsap, ScrollTrigger, useScene, useRefreshOnImages, flyTitle, focusPull, revealBatch, tiltRise,
  lockScroll, prefersReducedMotion,
} from '../motion.js'
import './ProjectDetail.css'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WIN_MAX = 12   // the window cycles the first twelve; the contact sheet shows every photo

/** Day / month / year for a date sun, or null when the update carries no date (Gold's splitDate). */
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
  if (ds.length === 0) return ''
  const label = (d) => MON[d.getMonth()] + ' ' + d.getFullYear()
  const from = label(ds[0]), to = label(ds[ds.length - 1])
  return from === to ? from : from + ' – ' + to
}

/** Admin HTML that says something (text, or at least a picture). */
const hasBody = (html) => !!(plainText(html) || /<img\b/i.test(html))

/** Cards already scrolled past are never hidden by an entrance. */
const onOrBelow = (els) => els.filter((el) => el.getBoundingClientRect().bottom > 0)

// ── one update, in its own panel (Gold's popup: photos, figures, write-up) ───
function UpdatePanel({ c, currency, lbOpen, onClose, onPhoto }) {
  const wrapRef = useRef(null)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

  useLayoutEffect(() => {
    if (closeRef.current) closeRef.current.focus({ preventScroll: true })
    if (prefersReducedMotion() || !panelRef.current) return undefined
    const t = gsap.fromTo(panelRef.current, { y: 70, opacity: 0, scale: 0.97 }, {
      y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out', clearProps: 'transform,opacity,translate,scale',
    })
    return () => { t.kill() }
  }, [c])

  // the viewer sits above this panel: while it is open the panel is inert
  useEffect(() => { if (wrapRef.current) wrapRef.current.inert = !!lbOpen }, [lbOpen])

  const figs = [
    c.costText && ['Project cost', c.costText],
    c.beneficiaries > 0 && ['Beneficiaries', groupInt(c.beneficiaries, currency)],
    c.rotarians > 0 && ['Rotarians', groupInt(c.rotarians, currency)],
    c.manHours > 0 && ['Man hours', groupInt(c.manHours, currency)],
  ].filter(Boolean)
  const html = demoteH1(c.descriptionHtml).trim()

  return createPortal(
    <div className="sun-pd-modal" ref={wrapRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="sun-pd-modal__bg" onClick={onClose} aria-hidden="true" />
      <div className="sun-pd-modal__panel" ref={panelRef}>
        <button type="button" className="sun-pd-modal__x" ref={closeRef} onClick={onClose}>
          <span className="sun-sr">Close update</span><CloseIcon />
        </button>
        <div className="sun-pd-modal__scroll" data-lenis-prevent="">
          <p className="sun-eyebrow">Project update</p>
          <h2 className="sun-pd-modal__t" id={titleId}>{noEmoji(c.title) || 'Project update'}</h2>
          {c.dateText || c.location ? (
            <ul className="sun-pd-facts sun-pd-modal__facts">
              {c.dateText ? <li><CalendarIcon /><span className="sun-sr">Date: </span>{c.dateText}</li> : null}
              {c.location ? <li><PinIcon /><span className="sun-sr">Location: </span>{c.location}</li> : null}
            </ul>
          ) : null}
          {c.photos.length ? (
            <ul className="sun-pd-modal__pics">
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
            <ul className="sun-stats sun-pd-modal__stats">
              {figs.map(([l, n]) => (
                <li className="sun-stat" key={l}>
                  <p className="sun-stat__num">{n}</p>
                  <p className="sun-stat__label">{l}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {hasBody(html) ? <div className="sun-prose sun-pd-modal__prose" dangerouslySetInnerHTML={{ __html: html }} /> : null}
        </div>
      </div>
    </div>, document.body)
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

  // demoChild (the local ?demoChild=1 preview) needs isLocalRequest, which data.js does not export.
  const { p, notFound } = useProjectData(pid, false, data)

  const share = useProjectShare({
    projectId: p ? p.id : 0,
    yearId: p ? p.yearId : null,
    fallback: p ? p.shareFallback : null,
  })
  const channels = shareChannels(share).filter((ch) => ch.href || ch.onClick)

  const photos = p ? p.photos || [] : []
  const captions = p ? p.photoCaptions || [] : []
  const kids = p ? p.children || [] : []
  const win = photos.slice(0, WIN_MAX)
  const s = useSlides(win.length, 6000)

  const [lb, setLb] = useState(null)              // { urls, caps, idx }
  const [openChild, setOpenChild] = useState(null)
  const lbBack = useRef(null)
  const childBack = useRef(null)
  const pageRef = useRef(null)
  const uid = useId()
  const lbOpen = !!lb
  const childOpen = !!openChild

  // `caps` travel WITH the urls: an update's photos must not borrow the main set's captions.
  const openLb = (urls, start, caps, e) => {
    if (!urls || urls.length === 0) return
    lbBack.current = e ? e.currentTarget : null
    setLb({ urls, caps: caps || [], idx: ((start % urls.length) + urls.length) % urls.length })
  }
  const openUpdate = (c, e) => { childBack.current = e.currentTarget; setOpenChild(c) }

  // While the viewer or an update is open, the site behind is inert and still (Lenis too).
  useEffect(() => {
    if (!lbOpen && !childOpen) return undefined
    const root = document.getElementById('root')
    if (root) root.inert = true
    document.body.style.overflow = 'hidden'
    lockScroll(true)
    return () => {
      if (root) root.inert = false
      document.body.style.overflow = ''
      lockScroll(false)
    }
  }, [lbOpen, childOpen])

  // Focus into the viewer, and back to whatever opened it.
  useEffect(() => {
    if (!lbOpen) return undefined
    const back = lbBack.current
    const raf = requestAnimationFrame(() => {
      const b = document.querySelector('.pdm-lb.open .pdm-lb__close')
      if (b) b.focus()
    })
    return () => {
      cancelAnimationFrame(raf)
      requestAnimationFrame(() => { if (back && back.isConnected) back.focus({ preventScroll: true }) })
    }
  }, [lbOpen])

  // The update panel returns focus on close, and owns Esc only while the viewer is closed.
  useEffect(() => {
    if (!childOpen) return undefined
    const back = childBack.current
    return () => requestAnimationFrame(() => { if (back && back.isConnected) back.focus({ preventScroll: true }) })
  }, [childOpen])
  useEffect(() => {
    if (!childOpen || lbOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpenChild(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [childOpen, lbOpen])

  // ── motion: the window rises like the sun; text focuses; sheet + updates arrive ──
  useScene(pageRef, (c) => {
    const root = pageRef.current
    const clear = 'transform,opacity,translate,rotate,scale'
    const winEl = root.querySelector('.sun-pd-win')
    const glow = root.querySelector('.sun-pd-stage__sun')
    if (winEl) gsap.fromTo(winEl, { y: 90, scale: 0.9, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 1.5, delay: 0.35, ease: 'power3.out', clearProps: clear })
    if (glow) gsap.fromTo(glow, { yPercent: 40, scale: 0.7, opacity: 0 }, { yPercent: 0, scale: 1, opacity: 1, duration: 2, delay: 0.2, ease: 'power3.out', clearProps: clear })
    flyTitle(root.querySelectorAll('.sun-fly'), c)
    focusPull(root.querySelectorAll('.sun-pd-prose > *'), c)

    const shots = Array.from(root.querySelectorAll('.sun-pd-shot'))
    if (c.wide) revealBatch(onOrBelow(shots), { stagger: 0.06 })
    else tiltRise(shots, 'img')

    // the updates: each row lifts and its date sun rises over it
    const rows = onOrBelow(Array.from(root.querySelectorAll('.sun-pd-run')))
    if (rows.length) {
      const sunOf = (list) => list.map((r) => r.querySelector('.sun-date')).filter(Boolean)
      gsap.set(rows, { y: 40, opacity: 0 })
      gsap.set(sunOf(rows), { y: 34, scale: 0.6 })
      ScrollTrigger.batch(rows, {
        start: 'top bottom',
        once: true,
        onEnter: (batch) => {
          gsap.to(batch, { y: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'power3.out', overwrite: true, clearProps: clear })
          gsap.to(sunOf(batch), { y: 0, scale: 1, duration: 1.2, delay: 0.1, stagger: 0.08, ease: 'back.out(1.5)', overwrite: true, clearProps: clear })
        },
      })
    }
  }, [p])
  useRefreshOnImages(pageRef, [p])

  if (notFound) {
    return (
      <NotFound
        title="Project not found"
        message="We couldn’t find the project you were looking for. It may have been moved, or it is no longer published."
        backHref={backHref}
        backLabel={backLabel}
        crumbs={[{ label: listLabel, href: backHref }, { label: 'Project not found' }]}
      />
    )
  }
  // Nothing claims "not found" before the fetch resolves.
  if (!p) return <div className="sun-page sun-pd"><div className="sun-wrap"><Loading label="Loading the project" /></div></div>

  const cur = club.currency
  const title = noEmoji(p.title) || 'Project'
  // what the old eyebrow said (the page head is crumbs + h1 only now)
  const kind = avenueLabel(p.moduleKey) || (fromMeetings ? 'Club service' : '')
  const year = yearText(club.selectedYearLabel)
  const html = demoteH1(p.description).trim()
  const showHtml = hasBody(html)
  const figs = [
    { label: 'Total cost', value: p.cost !== null && p.cost > 0 ? p.cost : 0, money: true },
    { label: 'Beneficiaries', value: p.beneficiaries },
    { label: 'Rotarians involved', value: p.rotarians },
    { label: 'Man hours', value: p.manHours },
  ]
  const showFigs = figs.some((f) => Number(f.value) > 0)
  const span = runSpan(kids)
  const i = Math.min(s.idx, Math.max(0, win.length - 1))
  const anyCaption = win.some((_, k) => captions[k])

  return (
    <div className={'sun-page sun-pd' + (showFigs && showHtml ? ' has-both' : '')} ref={pageRef}>
      <LightboxStyles />
      <PhotoLightbox urls={lb ? lb.urls : []} index={lb ? lb.idx : null} captions={lb ? lb.caps : null}
                     onIndex={(n) => setLb((l) => (n === null || !l ? null : { ...l, idx: n }))} />

      <PageHero
        title={title}
        size="md"
        menuTitle={false}
        crumbs={[{ label: listLabel, href: backHref }, { label: title }]}
      >
        {kind || p.dateText || p.location || year ? (
          <ul className="sun-pd-facts">
            {kind ? <li className="sun-pd-facts__kind">{kind}</li> : null}
            {p.dateText ? <li><CalendarIcon /><span className="sun-sr">Date: </span>{p.dateText}</li> : null}
            {p.location ? <li><PinIcon /><span className="sun-sr">Location: </span>{p.location}</li> : null}
            {year ? <li className="sun-pd-facts__yr">Rotary year <b>{year}</b></li> : null}
          </ul>
        ) : null}
      </PageHero>

      {/* ══ the window ══ */}
      {win.length ? (
        <section className="sun-wrap sun-pd-stage" aria-label="Photographs">
          <div className="sun-pd-stage__sun" aria-hidden="true" />
          <figure className="sun-pd-fig">
            <div className="sun-win sun-pd-win">
              <div className="sun-win__slides">
                {win.map((src, k) => (
                  <WinSlide key={k} src={src} alt={captions[k] || title + ', photo ' + (k + 1)} on={k === i} eager={k === 0} />
                ))}
              </div>
              <button type="button" className="sun-pd-win__open" onClick={(e) => openLb(photos, i, captions, e)}>
                <span className="sun-pd-win__chip">
                  <SearchIcon /><span className="sun-pd-win__lbl">View full size</span>
                  <span className="sun-sr">, photo {i + 1} of {photos.length}</span>
                </span>
              </button>
            </div>
            {anyCaption || win.length > 1 ? (
              <div className="sun-pd-fig__foot">
                {anyCaption ? <figcaption className="sun-pd-fig__cap">{captions[i] || ''}</figcaption> : <span />}
                <SlideCtrl n={win.length} s={s} label="Project photos" className="sun-pd-ctrl" />
              </div>
            ) : null}
          </figure>
        </section>
      ) : null}

      {/* ══ the story + the figures ══ */}
      {showHtml || showFigs ? (
        <div className="sun-wrap sun-block sun-pd-story">
          {showHtml ? (
            <section className="sun-pd-over" aria-labelledby={uid + 'o'}>
              <SectionHead id={uid + 'o'} eyebrow="Overview" title="About this project" />
              {/* Trusted admin rich HTML (already wrappable), rendered verbatim like Gold. */}
              <div className="sun-prose sun-pd-prose" dangerouslySetInnerHTML={{ __html: html }} />
            </section>
          ) : null}
          {showFigs ? (
            <section className="sun-pd-nums" aria-labelledby={uid + 'n'}>
              <h2 className="sun-eyebrow" id={uid + 'n'}>By the numbers</h2>
              <StatRow items={figs} currency={p.currency} className="sun-pd-stats" />
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ══ the contact sheet ══ */}
      {photos.length > 1 ? (
        <section className="sun-wrap sun-block sun-pd-photos" aria-labelledby={uid + 'p'}>
          <SectionHead id={uid + 'p'} eyebrow={photos.length + ' photos'} title="Photographs"
                       intro="Select a photo to view it full size." />
          <ul className="sun-pd-sheet">
            {photos.map((url, k) => (
              <li key={k} className="sun-pd-shot">
                <button type="button" className="sun-pd-shot__btn" onClick={(e) => openLb(photos, k, captions, e)}
                        aria-label={'View photo ' + (k + 1) + ' of ' + photos.length}
                        aria-describedby={captions[k] ? uid + 'c' + k : undefined}>
                  <img src={url} alt="" loading="lazy" decoding="async" width="800" height="600" onError={hideOnError} />
                  <span className="sun-pd-shot__n" aria-hidden="true">{String(k + 1).padStart(2, '0')}</span>
                </button>
                {captions[k] ? <p className="sun-pd-shot__cap" id={uid + 'c' + k}>{captions[k]}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ══ the updates ══ */}
      {kids.length ? (
        <section className="sun-wrap sun-block sun-pd-updates" aria-labelledby={uid + 'u'}>
          <SectionHead id={uid + 'u'}
                       eyebrow={kids.length + ' update' + (kids.length === 1 ? '' : 's') + (span ? ' · ' + span : '')}
                       title="Project updates" />
          <ol className="sun-pd-runs">
            {kids.map((c) => {
              const d = splitDate(c.date)
              return (
                <li key={c.id} className="sun-pd-run">
                  <button type="button" className="sun-pd-run__btn" aria-haspopup="dialog" onClick={(e) => openUpdate(c, e)}>
                    {d ? <DateSun small day={d.day} mon={d.mon} /> : <span className="sun-pd-run__nodate">Undated</span>}
                    <span className="sun-pd-run__body">
                      <span className="sun-pd-run__t">{noEmoji(c.title) || 'Project update'}</span>
                      {d || c.location || c.beneficiaries > 0 ? (
                        <span className="sun-pd-run__m">
                          {d ? <span>{d.year}</span> : null}
                          {c.location ? <span>{c.location}</span> : null}
                          {c.beneficiaries > 0 ? <span>{groupInt(c.beneficiaries, cur)} beneficiaries</span> : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="sun-pd-run__pic" aria-hidden="true">
                      {c.photos.length ? <img src={c.photos[0]} alt="" loading="lazy" decoding="async" width="160" height="120" onError={hideOnError} /> : null}
                    </span>
                    <Arrow className="sun-pd-run__go" />
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}

      {/* ══ share + the way back ══ */}
      <section className="sun-wrap sun-block sun-pd-end" aria-labelledby={uid + 's'}>
        <Panel className="sun-pd-end__panel">
          {channels.length ? (
            <div className="sun-pd-end__share">
              <h2 className="sun-eyebrow" id={uid + 's'}>Share this project</h2>
              <ul className="sun-pd-share">
                {channels.map((ch) => {
                  const glyph = (
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"
                         fill={ch.fill && !ch.done ? 'currentColor' : 'none'} stroke={ch.fill && !ch.done ? 'none' : 'currentColor'}
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {ch.done ? SHARE_ICONS.check : ch.icon}
                    </svg>
                  )
                  const newTab = !!ch.href && ch.key !== 'mail'
                  return (
                    <li key={ch.key}>
                      {ch.href ? (
                        <a href={ch.href} aria-label={ch.label + (newTab ? ' (opens in a new tab)' : '')} title={ch.label}
                           target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}
                           onClick={ch.popup ? sharePopup : undefined}>{glyph}</a>
                      ) : (
                        <button type="button" aria-label={ch.label} title={ch.label} onClick={ch.onClick}>{glyph}</button>
                      )}
                      {ch.doneLabel ? <span className={'sun-pd-share__toast' + (ch.done ? ' is-on' : '')} aria-live="polite">{ch.done ? ch.doneLabel : ''}</span> : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : <h2 className="sun-sr" id={uid + 's'}>More</h2>}
          <Button href={backHref} variant="line" icon="back">{backLabel}</Button>
        </Panel>
      </section>

      {openChild ? (
        <UpdatePanel c={openChild} currency={cur} lbOpen={lbOpen} onClose={() => setOpenChild(null)} onPhoto={openLb} />
      ) : null}
    </div>
  )
}
